import { useCallback, useRef, useState, type DragEvent } from 'react';
import { BookOpen, FileUp, Plus } from 'lucide-react';
import { clsx } from 'clsx';
import { useVaultStore } from '@/stores/vault';
import { describeError, useToastStore } from '@/stores/toast';
import { useUIStore } from '@/stores/ui';
import { LivingCanvas } from '@/components/fx/LivingCanvas';
import { useSporeMotion } from '@/hooks/useSporeMotion';
import { useHotkeyBindings } from '@/hooks/useHotkeyBindings';
import { formatHotkey } from '@/lib/commands';
import { isMac } from '@/lib/platform';
import { extFromMime, isImageFilename, saveAttachmentBytes } from '@/lib/attachments';
import type { FileEntry } from '@/types';

const TEXT_EXTS = ['md', 'markdown', 'txt'];

/** `Untitled.md`, `Untitled 2.md`, … — first name free at the vault root. */
function freeRootName(tree: FileEntry[], stem: string): string {
  const taken = new Set(tree.filter((e) => !e.is_dir).map((e) => e.name.toLowerCase()));
  const clean = stem.replace(/[\\/:*?"<>|]/g, ' ').trim() || 'Untitled';
  for (let i = 1; ; i++) {
    const name = i === 1 ? `${clean}.md` : `${clean} ${i}.md`;
    if (!taken.has(name.toLowerCase())) return name;
  }
}

function extOf(name: string): string {
  return name.includes('.') ? name.split('.').pop()!.toLowerCase() : '';
}

export function EmptyEditor() {
  const vaultRoot = useVaultStore((s) => s.vaultRoot);
  const setQuickSwitcherOpen = useUIStore((s) => s.setQuickSwitcherOpen);
  const bindings = useHotkeyBindings();
  const sporeMotion = useSporeMotion();
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);

  const searchKey = bindings['omnibar.open'] ? formatHotkey(bindings['omnibar.open'], isMac) : '';

  const newNote = useCallback(async () => {
    const { fileTree, createNote } = useVaultStore.getState();
    try {
      await createNote(freeRootName(fileTree, 'Untitled'));
    } catch (e) {
      useToastStore.getState().error(describeError(e));
    }
  }, []);

  /** Markdown/text files become notes; images land in attachments/. */
  const importFiles = useCallback(async (files: File[]) => {
    if (!files.length) return;
    setBusy(true);
    const { createNote, openImageTab } = useVaultStore.getState();
    let skipped = 0;
    try {
      for (const f of files) {
        const ext = extOf(f.name);
        if (TEXT_EXTS.includes(ext)) {
          const stem = f.name.replace(/\.[^.]+$/, '');
          const name = freeRootName(useVaultStore.getState().fileTree, stem);
          await createNote(name, await f.text());
        } else if (f.type.startsWith('image/') || isImageFilename(f.name)) {
          const rel = await saveAttachmentBytes(
            new Uint8Array(await f.arrayBuffer()),
            extFromMime(f.type) || ext || 'bin',
          );
          openImageTab(rel);
        } else {
          skipped++;
        }
      }
      if (skipped) {
        useToastStore
          .getState()
          .error(`${skipped} file${skipped > 1 ? 's' : ''} skipped — import Markdown, text or images`);
      }
    } catch (e) {
      useToastStore.getState().error(describeError(e));
    } finally {
      setBusy(false);
    }
  }, []);

  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes('Files')) return;
    e.preventDefault();
    setDragging(true);
  };
  const onDragLeave = (e: DragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDragging(false);
  };
  const onDrop = (e: DragEvent) => {
    if (!e.dataTransfer.files.length) return;
    e.preventDefault();
    setDragging(false);
    void importFiles(Array.from(e.dataTransfer.files));
  };

  return (
    <div
      className="relative flex flex-col items-center justify-center h-full overflow-hidden select-none"
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={onDrop}
    >
      <LivingCanvas still={!sporeMotion} />
      <div className="myc-canvas-veil" />

      <div className="relative z-10 flex flex-col items-center gap-5 px-6 text-center pointer-events-none">
        <BookOpen size={34} strokeWidth={1.4} className="text-text-secondary" aria-hidden="true" />
        <div className="flex flex-col gap-2">
          <h2 className="text-2xl font-medium tracking-tight text-text-primary">
            Your canvas is ready
          </h2>
          {vaultRoot && (
            <p className="text-sm text-text-secondary leading-relaxed">
              Create a note, or drop a file here
              <br />
              to start building your knowledge.
            </p>
          )}
        </div>

        <div className="flex items-center gap-3 pt-1 pointer-events-auto">
          <button onClick={newNote} className="myc-btn myc-btn-primary h-10 px-5 text-sm">
            New note <Plus size={16} />
          </button>
          <button
            onClick={() => inputRef.current?.click()}
            disabled={busy}
            className="myc-btn myc-btn-secondary h-10 px-4 text-sm"
          >
            <FileUp size={15} /> {busy ? 'Importing…' : 'Import file'}
          </button>
        </div>

        {searchKey && (
          <button
            onClick={() => setQuickSwitcherOpen(true)}
            className="pointer-events-auto flex items-center gap-2 text-xs text-text-muted hover:text-text-secondary transition-colors"
          >
            <kbd className="myc-kbd">{searchKey}</kbd> search or run a command
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        multiple
        accept=".md,.markdown,.txt,image/*"
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = '';
          void importFiles(files);
        }}
      />

      <div
        aria-hidden="true"
        className={clsx(
          'absolute inset-3 z-20 rounded-2xl border-2 border-dashed pointer-events-none transition-opacity',
          'border-accent/60 bg-accent/5',
          dragging ? 'opacity-100' : 'opacity-0',
        )}
      />
    </div>
  );
}
