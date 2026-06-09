import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { X, Loader2, FolderInput } from 'lucide-react';
import { useVaultStore } from '@/stores/vault';
import { useInsightsStore } from '@/stores/insights';
import { displayName } from '@/lib/note-name';
import type { Note } from '@/types';

interface Props {
  /// Vault-relative path of the quick note being filed.
  source: string;
  /// Vault-relative path of the note it merges into.
  target: string;
  onClose: () => void;
  /// Called after the merge landed, so the card can mark the insight acted.
  onResolved: () => void;
}

/// Confirmation dialog for a quick-note merge. Shows the source's current
/// content (re-read at open, and re-read again by the backend at confirm
/// time) and spells out exactly what happens, because the default path
/// deletes the source file.
export function MergeQuickNoteDialog({ source, target, onClose, onResolved }: Props) {
  const status = useInsightsStore((s) => s.status);
  const openNote = useVaultStore((s) => s.openNote);
  const closeTab = useVaultStore((s) => s.closeTab);
  const refreshTree = useVaultStore((s) => s.refreshTree);

  const [content, setContent] = useState<string | null>(null);
  const [deleteSource, setDeleteSource] = useState(
    status?.settings.quick_filing_delete_after_merge ?? true,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<Note>('note_read', { path: source })
      .then((note) => {
        if (!cancelled) setContent(note.content);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [source]);

  const merge = async () => {
    setBusy(true);
    setError(null);
    try {
      await invoke<string>('quick_note_merge', {
        source,
        target,
        deleteSource,
      });
      if (deleteSource) closeTab(source);
      await refreshTree();
      await openNote(target).catch(console.error);
      onResolved();
      onClose();
    } catch (e) {
      setError(String(e));
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-[36rem] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)] bg-surface-1 border border-border rounded-lg shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-3 border-b border-border bg-surface-0">
          <h2 className="flex items-center gap-2 text-text-primary text-sm font-semibold">
            <FolderInput size={15} className="text-accent" />
            File quick note into “{displayName(target)}”
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded text-text-muted hover:bg-surface-hover hover:text-text-primary"
            title="Cancel (Esc)"
          >
            <X size={16} />
          </button>
        </header>

        <div className="p-5 overflow-y-auto flex flex-col gap-3">
          <p className="text-xs text-text-secondary leading-relaxed">
            The quick note’s content is appended to{' '}
            <span className="text-text-primary">{target}</span> as a dated{' '}
            <code className="text-[11px]">## Quick note</code> section with a
            link back to where it came from.
          </p>

          {error && <div className="text-[11px] text-error">{error}</div>}

          <div className="border border-border rounded-md bg-surface-0 overflow-hidden">
            <div className="px-3 py-1.5 border-b border-border text-[10px] text-text-muted truncate">
              {source}
            </div>
            {content === null ? (
              <div className="flex items-center gap-2 px-3 py-4 justify-center text-text-muted text-xs">
                <Loader2 size={12} className="animate-spin" /> Loading…
              </div>
            ) : (
              <pre className="px-3 py-2 text-[11px] text-text-secondary whitespace-pre-wrap break-words max-h-56 overflow-y-auto font-mono">
                {content || '(empty note)'}
              </pre>
            )}
          </div>

          <label className="flex items-start gap-2 text-xs text-text-secondary cursor-pointer">
            <input
              type="checkbox"
              checked={deleteSource}
              onChange={(e) => setDeleteSource(e.target.checked)}
              className="mt-0.5"
            />
            <span>
              Delete the quick note after merging.
              <span className="block text-[11px] text-text-muted mt-0.5">
                {deleteSource
                  ? 'Its content lives on inside the target note.'
                  : 'The file stays in your quick folder, marked as filed so it isn’t suggested again.'}
              </span>
            </span>
          </label>
        </div>

        <footer className="px-5 py-2.5 border-t border-border bg-surface-0 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1 rounded text-xs border border-border bg-surface-1 text-text-secondary hover:bg-surface-hover disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void merge()}
            disabled={busy || content === null}
            className="flex items-center gap-1.5 px-3 py-1 rounded text-xs bg-accent text-white hover:opacity-90 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {busy ? (
              <Loader2 size={12} className="animate-spin" />
            ) : (
              <FolderInput size={12} />
            )}
            Merge{deleteSource ? ' & delete original' : ''}
          </button>
        </footer>
      </div>
    </div>
  );
}
