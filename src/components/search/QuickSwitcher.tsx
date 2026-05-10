import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { clsx } from 'clsx';
import { FileText, Search } from 'lucide-react';
import { useVaultStore } from '@/stores/vault';
import { DisconnectedSpore } from '@/components/brand/Spore';

interface NoteSummary {
  path: string;
  title: string;
}

interface Props {
  onClose: () => void;
}

function fuzzyMatch(query: string, text: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

function fuzzyScore(query: string, text: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  // Bonus for consecutive matches and prefix matches
  if (t.startsWith(q)) return 100;
  if (t.includes(q)) return 50;
  return 10;
}

export function QuickSwitcher({ onClose }: Props) {
  const [query, setQuery] = useState('');
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { openNote } = useVaultStore();

  useEffect(() => {
    invoke<NoteSummary[]>('notes_list').then(setNotes).catch(console.error);
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const filtered = notes
    .filter((n) => fuzzyMatch(query, n.title) || fuzzyMatch(query, n.path))
    .sort((a, b) => fuzzyScore(query, b.title) - fuzzyScore(query, a.title))
    .slice(0, 10);

  const handleSelect = useCallback(
    (path: string) => {
      openNote(path);
      onClose();
    },
    [openNote, onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelected((s) => Math.min(s + 1, filtered.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
      } else if (e.key === 'Enter') {
        if (filtered[selected]) {
          handleSelect(filtered[selected].path);
        }
      }
    },
    [filtered, selected, handleSelect, onClose],
  );

  useEffect(() => {
    setSelected(0);
  }, [query]);

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
          <Search size={16} className="text-text-muted shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Open note…"
            className="flex-1 bg-transparent text-text-primary placeholder:text-text-muted outline-none text-sm"
          />
          <kbd className="text-xs text-text-muted bg-surface-2 px-1.5 py-0.5 rounded">Esc</kbd>
        </div>

        <div className="max-h-80 overflow-y-auto py-1">
          {filtered.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-text-muted">
              <DisconnectedSpore size={32} className="text-accent-muted" />
              <p className="text-sm">No notes found</p>
              <p className="text-xs opacity-70">try a different fragment</p>
            </div>
          ) : (
            filtered.map((note, i) => (
              <button
                key={note.path}
                onClick={() => handleSelect(note.path)}
                className={clsx(
                  'w-full flex items-center gap-3 px-4 py-2 text-left',
                  i === selected
                    ? 'bg-accent/12 text-text-primary border-l-2 border-accent'
                    : 'text-text-secondary hover:bg-surface-hover border-l-2 border-transparent',
                )}
              >
                <FileText size={14} className="shrink-0 text-text-muted" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{note.title}</div>
                  <div className="text-xs text-text-muted truncate">{note.path}</div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
