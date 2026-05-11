import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { FileText, Hash } from 'lucide-react';
import { useVaultStore } from '@/stores/vault';
import { DisconnectedSpore } from '@/components/brand/Spore';

interface NoteSummary {
  path: string;
  title: string;
}

interface Props {
  tag: string;
  onClose: () => void;
}

export function TagSearch({ tag, onClose }: Props) {
  const [notes, setNotes] = useState<NoteSummary[] | null>(null);
  const { openNote } = useVaultStore();

  useEffect(() => {
    setNotes(null);
    invoke<NoteSummary[]>('notes_by_tag', { tag })
      .then(setNotes)
      .catch((e) => {
        console.error(e);
        setNotes([]);
      });
  }, [tag]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const handleSelect = (path: string) => {
    openNote(path);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/55"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg bg-surface-2 rounded-xl shadow-glow border border-border-strong overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <Hash size={16} className="text-tag shrink-0" />
          <span className="flex-1 text-sm text-text-primary">
            Notes tagged{' '}
            <span className="text-tag font-medium">#{tag}</span>
          </span>
          <kbd className="text-xs text-text-muted bg-surface-2 px-1.5 py-0.5 rounded">Esc</kbd>
        </div>

        <div className="max-h-80 overflow-y-auto py-1">
          {notes === null ? (
            <p className="px-4 py-6 text-center text-xs text-text-muted">Searching…</p>
          ) : notes.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-text-muted">
              <DisconnectedSpore size={32} className="text-accent-muted" />
              <p className="text-sm">No notes with this tag</p>
            </div>
          ) : (
            notes.map((n) => (
              <button
                key={n.path}
                onClick={() => handleSelect(n.path)}
                className="w-full flex items-center gap-3 px-4 py-2 text-left text-text-secondary hover:bg-surface-hover border-l-2 border-transparent hover:border-accent"
              >
                <FileText size={14} className="shrink-0 text-text-muted" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{n.title}</div>
                  <div className="text-xs text-text-muted truncate">{n.path}</div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
