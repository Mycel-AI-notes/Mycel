import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { clsx } from 'clsx';
import { FileText, TextSearch } from 'lucide-react';
import { useVaultStore } from '@/stores/vault';
import { DisconnectedSpore } from '@/components/brand/Spore';
import { getEditorView, scrollEditorToLine } from '@/lib/editor-registry';
import {
  flattenRows,
  QUERY_HELP,
  splitHighlight,
  type FullTextHit,
  type ResultRow,
} from '@/lib/fulltext';

interface Props {
  onClose: () => void;
}

// Local SQLite query, so this only has to absorb keystroke bursts — not a
// network round-trip like the semantic search in the quick switcher.
const DEBOUNCE_MS = 150;

// Enough to scroll through, small enough that highlighting every snippet
// stays instant. The backend clamps independently.
const RESULT_LIMIT = 200;

// Survives closing the panel, so ⌘⇧F → Enter → ⌘⇧F lands back on the same
// results — the usual "check the next hit" loop.
let lastQuery = '';

/** Open `path` and put the caret on `line` (1-based) once the editor mounts. */
function openAtLine(path: string, line: number | null) {
  void useVaultStore
    .getState()
    .openNote(path)
    .then(() => {
      if (line == null) return;
      // The editor may need a few frames to mount and register its view.
      let tries = 0;
      const tryScroll = () => {
        if (getEditorView(path) || tries > 20) {
          scrollEditorToLine(path, line - 1);
          return;
        }
        tries++;
        requestAnimationFrame(tryScroll);
      };
      tryScroll();
    });
}

function Highlighted({ text }: { text: string }) {
  return (
    <>
      {splitHighlight(text).map((p, i) =>
        p.hit ? (
          <mark key={i} className="bg-accent/25 text-text-primary rounded-sm px-px">
            {p.text}
          </mark>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </>
  );
}

export function FullTextSearch({ onClose }: Props) {
  const [query, setQuery] = useState(lastQuery);
  const [hits, setHits] = useState<FullTextHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  // Debounced search. A request id drops responses that arrive after a
  // newer query was issued.
  const requestId = useRef(0);
  useEffect(() => {
    lastQuery = query;
    const q = query.trim();
    const id = ++requestId.current;
    if (!q) {
      setHits([]);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    const handle = setTimeout(async () => {
      try {
        const res = await invoke<FullTextHit[]>('search_fulltext', {
          query: q,
          limit: RESULT_LIMIT,
        });
        if (requestId.current !== id) return;
        setHits(res);
        setError(null);
      } catch (e) {
        if (requestId.current !== id) return;
        setHits([]);
        setError(String(e));
      } finally {
        if (requestId.current === id) setLoading(false);
      }
    }, DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query]);

  const rows = useMemo(() => flattenRows(hits), [hits]);

  useEffect(() => {
    setSelected(0);
  }, [hits]);

  // Keep the keyboard selection visible while arrowing through a long list.
  useEffect(() => {
    listRef.current
      ?.querySelector<HTMLElement>(`[data-row="${selected}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const choose = useCallback(
    (row: ResultRow) => {
      openAtLine(row.path, row.line);
      onClose();
    },
    [onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelected((s) => Math.min(s + 1, rows.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
      } else if (e.key === 'Enter') {
        e.preventDefault();
        const row = rows[selected];
        if (row) choose(row);
      }
    },
    [rows, selected, choose, onClose],
  );

  // Row index of each hit's first row, so the grouped render can number its
  // rows to match the flat list the keyboard walks.
  const firstRowOfHit = useMemo(() => {
    const m = new Map<number, number>();
    rows.forEach((r, i) => {
      if (!m.has(r.hitIndex)) m.set(r.hitIndex, i);
    });
    return m;
  }, [rows]);

  const q = query.trim();

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] bg-black/55"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl bg-surface-2 rounded-xl shadow-glow border border-border-strong overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <TextSearch size={16} className="text-text-muted shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search in notes…"
            className="flex-1 bg-transparent text-text-primary placeholder:text-text-muted outline-none text-sm"
          />
          {q && !loading && !error && (
            <span className="text-[11px] text-text-muted shrink-0">
              {hits.length === RESULT_LIMIT ? `${RESULT_LIMIT}+` : hits.length}{' '}
              {hits.length === 1 ? 'note' : 'notes'}
            </span>
          )}
          {loading && <span className="text-[11px] text-text-muted shrink-0">…</span>}
          <kbd className="text-xs text-text-muted bg-surface-2 px-1.5 py-0.5 rounded">Esc</kbd>
        </div>

        <div ref={listRef} className="max-h-[60vh] overflow-y-auto py-1">
          {error ? (
            <p className="px-4 py-6 text-center text-xs text-text-muted">{error}</p>
          ) : !q ? (
            <p className="px-4 py-6 text-center text-xs text-text-muted">
              Type to search the text of every note.
            </p>
          ) : hits.length === 0 ? (
            !loading && (
              <div className="flex flex-col items-center gap-2 py-8 text-text-muted">
                <DisconnectedSpore size={32} className="text-accent-muted" />
                <p className="text-sm">Nothing found</p>
                <p className="text-xs opacity-70">try fewer words or a shorter prefix</p>
              </div>
            )
          ) : (
            hits.map((hit, hitIndex) => {
              const base = firstRowOfHit.get(hitIndex) ?? 0;
              const headerOnly = hit.snippets.length === 0;
              const headerSelected = headerOnly && selected === base;
              return (
                <div key={hit.path} className="py-1">
                  <button
                    data-row={headerOnly ? base : undefined}
                    onClick={() =>
                      choose({
                        hitIndex,
                        snippetIndex: -1,
                        path: hit.path,
                        line: hit.line,
                      })
                    }
                    className={clsx(
                      'w-full flex items-center gap-2 px-4 py-1 text-left border-l-2',
                      headerSelected
                        ? 'bg-accent/12 border-accent text-text-primary'
                        : 'border-transparent text-text-secondary hover:bg-surface-hover',
                    )}
                  >
                    <FileText size={14} className="shrink-0 text-text-muted" />
                    <span className="text-sm font-medium truncate">
                      <Highlighted text={hit.title_highlight} />
                    </span>
                    <span className="text-xs text-text-muted truncate ml-auto pl-2">
                      {hit.path}
                    </span>
                  </button>
                  {hit.snippets.map((s, si) => {
                    const rowIndex = base + si;
                    return (
                      <button
                        key={`${s.line}-${si}`}
                        data-row={rowIndex}
                        onClick={() =>
                          choose({ hitIndex, snippetIndex: si, path: hit.path, line: s.line })
                        }
                        className={clsx(
                          'w-full flex items-baseline gap-3 pl-10 pr-4 py-0.5 text-left border-l-2',
                          rowIndex === selected
                            ? 'bg-accent/12 border-accent text-text-primary'
                            : 'border-transparent text-text-secondary hover:bg-surface-hover',
                        )}
                      >
                        <span className="text-[10px] tabular-nums text-text-muted w-8 shrink-0 text-right">
                          {s.line}
                        </span>
                        <span className="text-xs truncate">
                          <Highlighted text={s.text} />
                        </span>
                      </button>
                    );
                  })}
                </div>
              );
            })
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 border-t border-border text-[11px] text-text-muted">
          {QUERY_HELP.map((h) => (
            <span key={h.syntax}>
              <code className="text-accent">{h.syntax}</code> {h.meaning}
            </span>
          ))}
          <span className="ml-auto">↑↓ navigate · ↵ open</span>
        </div>
      </div>
    </div>
  );
}
