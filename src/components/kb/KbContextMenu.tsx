import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { BookOpen, Sprout, Trash2, Unlink } from 'lucide-react';
import { confirm } from '@tauri-apps/plugin-dialog';
import type { FileEntry, KbInitResult } from '@/types';
import { useVaultStore } from '@/stores/vault';
import { KbDeleteConfirm } from './KbDeleteConfirm';

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
  const [deleting, setDeleting] = useState(false);
  const { refreshTree, openNote } = useVaultStore();

  useEffect(() => {
    // While the delete-confirm modal is up, the menu itself is hidden but
    // alive (we render the modal as a sibling). Don't dismiss it on the
    // background clicks the modal is fielding.
    if (deleting) return;
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
  }, [onClose, deleting]);

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

  async function handleDeinit() {
    onClose();
    const ok = await confirm(
      `${entry.path}/ перестанет быть базой знаний. index.md и ${entry.path}.db.json останутся на диске.`,
      { title: 'Разжаловать в обычную папку?', kind: 'warning' },
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
  const menuHeight = isKb ? 140 : 56;
  const left = Math.min(x, window.innerWidth - menuWidth - 8);
  const top = Math.min(y, window.innerHeight - menuHeight - 8);

  return (
    <>
      {!deleting && (
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
              <div className="my-1 h-px bg-border" />
              <button
                onClick={handleDeinit}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-text-secondary hover:bg-surface-hover"
              >
                <Unlink size={14} />
                Разжаловать в обычную папку
              </button>
              <button
                onClick={() => setDeleting(true)}
                className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-error hover:bg-error/10"
              >
                <Trash2 size={14} />
                Удалить базу данных…
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
      )}
      {deleting && (
        <KbDeleteConfirm
          dirPath={entry.path}
          onClose={() => {
            setDeleting(false);
            onClose();
          }}
        />
      )}
    </>
  );
}
