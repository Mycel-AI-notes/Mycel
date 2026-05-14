import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { X, Loader2, Trash2, AlertTriangle } from 'lucide-react';
import { useVaultStore } from '@/stores/vault';
import type { Note } from '@/types';

interface Props {
  /// Exactly two note paths — the duplicate pair.
  paths: string[];
  onClose: () => void;
  /// Called after one note was deleted, so the card can mark the insight
  /// resolved and remove itself from the inbox.
  onResolved: () => void;
}

interface Loaded {
  path: string;
  content: string;
}

/// "Keep one, delete the other" picker for a duplicate-notes insight.
///
/// Deletion is destructive, so the dialog shows each note's path and a
/// content preview, and the action buttons spell out exactly what gets
/// removed. No "merge" — that's deliberately out of scope.
export function ResolveDuplicateDialog({ paths, onClose, onResolved }: Props) {
  const deleteNote = useVaultStore((s) => s.deleteNote);
  const [loaded, setLoaded] = useState<Loaded[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all(
      paths.map(async (path) => {
        const note = await invoke<Note>('note_read', { path });
        return { path, content: note.content };
      }),
    )
      .then((res) => {
        if (!cancelled) setLoaded(res);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [paths]);

  // `keepIdx` is the note the user keeps; the other is deleted.
  const resolve = async (keepIdx: number) => {
    const deletePath = paths[keepIdx === 0 ? 1 : 0];
    setBusy(true);
    setError(null);
    try {
      await deleteNote(deletePath);
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
        className="w-[44rem] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)] bg-surface-1 border border-border rounded-lg shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-3 border-b border-border bg-surface-0">
          <h2 className="text-text-primary text-sm font-semibold">
            Resolve duplicate — choose which note to keep
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded text-text-muted hover:bg-surface-hover hover:text-text-primary"
            title="Cancel (Esc)"
          >
            <X size={16} />
          </button>
        </header>

        <div className="p-5 overflow-y-auto">
          <div className="flex items-start gap-2 mb-4 text-[11px] text-text-muted">
            <AlertTriangle size={14} className="shrink-0 text-error mt-px" />
            <span>
              The note you don’t keep is deleted permanently. Links pointing
              to it will break. There’s no merge — copy anything you need
              first.
            </span>
          </div>

          {error && (
            <div className="text-[11px] text-error mb-3">{error}</div>
          )}

          {!loaded ? (
            <div className="flex items-center gap-2 py-10 justify-center text-text-muted text-sm">
              <Loader2 size={14} className="animate-spin" /> Loading notes…
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              {loaded.map((note, idx) => (
                <div
                  key={note.path}
                  className="flex flex-col border border-border rounded-md bg-surface-0 overflow-hidden"
                >
                  <div className="px-3 py-2 border-b border-border">
                    <div
                      className="text-xs font-medium text-text-primary truncate"
                      title={note.path}
                    >
                      {note.path}
                    </div>
                    <div className="text-[10px] text-text-muted mt-0.5 tabular-nums">
                      {note.content.length.toLocaleString()} chars ·{' '}
                      {note.content.split('\n').length} lines
                    </div>
                  </div>
                  <pre className="flex-1 px-3 py-2 text-[11px] text-text-secondary whitespace-pre-wrap break-words max-h-48 overflow-y-auto font-mono">
                    {note.content.slice(0, 600) ||
                      '(empty note)'}
                    {note.content.length > 600 ? '\n…' : ''}
                  </pre>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => void resolve(idx)}
                    className="flex items-center justify-center gap-1.5 px-3 py-2 text-xs border-t border-border bg-surface-1 text-text-primary hover:bg-surface-hover disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {busy ? (
                      <Loader2 size={12} className="animate-spin" />
                    ) : (
                      <Trash2 size={12} className="text-error" />
                    )}
                    Keep this · delete the other
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        <footer className="px-5 py-2 border-t border-border bg-surface-0 flex justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-3 py-1 rounded text-xs border border-border bg-surface-1 text-text-secondary hover:bg-surface-hover disabled:opacity-50"
          >
            Cancel
          </button>
        </footer>
      </div>
    </div>
  );
}
