import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { BookOpen, RefreshCw, Sprout, Trash2 } from 'lucide-react';
import { confirm } from '@tauri-apps/plugin-dialog';
import type { FileEntry, KbInitResult } from '@/types';
import { useVaultStore } from '@/stores/vault';

interface Props {
  x: number;
  y: number;
  entry: FileEntry;
  onClose: () => void;
}

/// Floating context menu for KB-related folder actions. Lives in a portaled
/// fixed-position div anchored at the cursor; closes on outside click, Esc,
/// or scroll.
export function KbContextMenu({ x, y, entry, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const { refreshTree, openNote } = useVaultStore();

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    document.addEventListener('scroll', onClose, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('scroll', onClose, true);
    };
  }, [onClose]);

  const isKb = !!entry.is_kb_dir;

  async function handleInit() {
    onClose();
    try {
      const result = await invoke<KbInitResult>('kb_init', { dirPath: entry.path });
      await refreshTree();
      await openNote(result.index_path, { preview: false });
    } catch (e) {
      console.error('kb_init failed', e);
    }
  }

  async function handleOpen() {
    onClose();
    try {
      await openNote(`${entry.path}/index.md`, { preview: false });
    } catch (e) {
      console.error('open KB index failed', e);
    }
  }

  async function handleRefresh() {
    onClose();
    try {
      await invoke('kb_refresh', { dirPath: entry.path });
    } catch (e) {
      console.error('kb_refresh failed', e);
    }
  }

  async function handleRemove() {
    onClose();
    const ok = await confirm(
      `Будут удалены ${entry.path}/index.md и ${entry.path}.db.json. Сами .md файлы внутри папки останутся.`,
      { title: 'Удалить базу знаний с папки?', kind: 'warning' },
    );
    if (!ok) return;
    try {
      await invoke('kb_deinit', { dirPath: entry.path });
      await refreshTree();
    } catch (e) {
      console.error('kb_deinit failed', e);
    }
  }

  // Clamp to viewport so the menu doesn't render past the right/bottom edges.
  const menuWidth = 260;
  const menuHeight = isKb ? 128 : 56;
  const left = Math.min(x, window.innerWidth - menuWidth - 8);
  const top = Math.min(y, window.innerHeight - menuHeight - 8);

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[240px] rounded-md border border-border bg-surface-0 shadow-lg py-1 text-sm"
      style={{ left, top }}
      onClick={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {isKb ? (
        <>
          <button
            onClick={handleOpen}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-text-primary hover:bg-surface-hover"
          >
            <BookOpen size={14} />
            Open Knowledge Base
          </button>
          <button
            onClick={handleRefresh}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-text-primary hover:bg-surface-hover"
          >
            <RefreshCw size={14} />
            Обновить из файлов
          </button>
          <div className="my-1 h-px bg-border" />
          <button
            onClick={handleRemove}
            className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-error hover:bg-error/10"
          >
            <Trash2 size={14} />
            Удалить базу знаний с папки
          </button>
        </>
      ) : (
        <button
          onClick={handleInit}
          className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-text-primary hover:bg-surface-hover"
        >
          <Sprout size={14} className="text-accent" />
          Превратить в базу знаний
        </button>
      )}
    </div>
  );
}
