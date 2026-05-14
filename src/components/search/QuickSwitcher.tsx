import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { clsx } from 'clsx';
import { FileText, Search, Sparkles } from 'lucide-react';
import { useVaultStore } from '@/stores/vault';
import { useAiStore } from '@/stores/ai';
import { DisconnectedSpore } from '@/components/brand/Spore';
import { reciprocalRankFusion, type FusedItem } from '@/lib/rrf';

interface NoteSummary {
  path: string;
  title: string;
}

interface SemanticHit {
  note_path: string;
  chunk_text: string;
  distance: number;
}

interface Props {
  onClose: () => void;
}

// How long to wait after the last keystroke before firing the semantic
// search. Keyword filter is instant (pure JS); the network round-trip
// dominates here. 250ms is a good "typing pause" threshold.
const SEMANTIC_DEBOUNCE_MS = 250;

// Max notes to show. Spec calls for 10 — small enough to scan, big
// enough that semantic hits past the keyword top still surface.
const RESULT_LIMIT = 10;

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
  if (t.startsWith(q)) return 100;
  if (t.includes(q)) return 50;
  return 10;
}

interface ResultRow {
  path: string;
  title: string;
  /// Source bitmask: 1 = keyword, 2 = semantic. Drives the badge.
  sources: number;
  /// Snippet shown under the title for content-only hits. Empty for
  /// keyword hits (the path subtitle is enough).
  snippet: string;
}

export function QuickSwitcher({ onClose }: Props) {
  const [query, setQuery] = useState('');
  const [notes, setNotes] = useState<NoteSummary[]>([]);
  const [semantic, setSemantic] = useState<SemanticHit[]>([]);
  const [semanticLoading, setSemanticLoading] = useState(false);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const { openNote } = useVaultStore();
  const aiStatus = useAiStore((s) => s.status);
  const aiIndex = useAiStore((s) => s.indexStatus);

  // Semantic search runs only when there's something to find. Cheap
  // upfront gating saves a Tauri round-trip and a pending request that
  // would just return [].
  const semanticAvailable =
    !!aiStatus?.enabled && !!aiStatus?.has_key && (aiIndex?.chunks_indexed ?? 0) > 0;

  useEffect(() => {
    invoke<NoteSummary[]>('notes_list').then(setNotes).catch(console.error);
  }, []);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Debounced semantic search. We use a ref-tracked request id so an
  // older response can't overwrite a newer one if the user types
  // faster than the network responds.
  const requestId = useRef(0);
  useEffect(() => {
    const q = query.trim();
    if (!q || !semanticAvailable) {
      setSemantic([]);
      setSemanticLoading(false);
      return;
    }
    const id = ++requestId.current;
    setSemanticLoading(true);
    const handle = setTimeout(async () => {
      try {
        const hits = await invoke<SemanticHit[]>('ai_semantic_search', {
          args: { query: q, k: RESULT_LIMIT },
        });
        if (requestId.current !== id) return;
        setSemantic(hits);
      } catch {
        // Silent: search failure shouldn't blank the keyword results.
        // The user will still see fuzzy hits.
        if (requestId.current === id) setSemantic([]);
      } finally {
        if (requestId.current === id) setSemanticLoading(false);
      }
    }, SEMANTIC_DEBOUNCE_MS);
    return () => clearTimeout(handle);
  }, [query, semanticAvailable]);

  const results: ResultRow[] = useMemo(() => {
    const q = query.trim();
    if (!q) {
      // No query → show the keyword list as-is (mirrors prior behavior).
      return notes.slice(0, RESULT_LIMIT).map((n) => ({
        path: n.path,
        title: n.title,
        sources: 1,
        snippet: '',
      }));
    }

    // Keyword (fuzzy) hits, ranked by the existing score function.
    const keywordHits = notes
      .filter((n) => fuzzyMatch(q, n.title) || fuzzyMatch(q, n.path))
      .sort((a, b) => fuzzyScore(q, b.title) - fuzzyScore(q, a.title))
      .slice(0, RESULT_LIMIT * 2); // headroom for RRF

    // Build a path → metadata lookup so the merged list can render
    // titles and snippets without re-scanning either source.
    const titles = new Map(notes.map((n) => [n.path, n.title]));
    const snippets = new Map(semantic.map((h) => [h.note_path, h.chunk_text]));

    const fused: FusedItem<string>[] = reciprocalRankFusion(
      [
        { items: keywordHits.map((n) => ({ key: n.path })) },
        { items: semantic.map((h) => ({ key: h.note_path })) },
      ],
    );

    return fused.slice(0, RESULT_LIMIT).map((f) => {
      // sourceIdx 0 = keyword, 1 = semantic. Encode as bitmask so a
      // single number drives the badge logic below.
      let mask = 0;
      if (f.sources.includes(0)) mask |= 1;
      if (f.sources.includes(1)) mask |= 2;
      return {
        path: f.key,
        title: titles.get(f.key) ?? f.key,
        sources: mask,
        // Snippet only when the hit came purely from semantic — for
        // keyword hits the title already tells the user why it matched.
        snippet: mask === 2 ? trimSnippet(snippets.get(f.key) ?? '') : '',
      };
    });
  }, [notes, semantic, query]);

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
        setSelected((s) => Math.min(s + 1, results.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelected((s) => Math.max(s - 1, 0));
      } else if (e.key === 'Enter') {
        if (results[selected]) {
          handleSelect(results[selected].path);
        }
      }
    },
    [results, selected, handleSelect, onClose],
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
            placeholder={semanticAvailable ? 'Open note or search…' : 'Open note…'}
            className="flex-1 bg-transparent text-text-primary placeholder:text-text-muted outline-none text-sm"
          />
          {semanticLoading && (
            <Sparkles size={12} className="text-accent animate-pulse shrink-0" />
          )}
          <kbd className="text-xs text-text-muted bg-surface-2 px-1.5 py-0.5 rounded">Esc</kbd>
        </div>

        <div className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-text-muted">
              <DisconnectedSpore size={32} className="text-accent-muted" />
              <p className="text-sm">No notes found</p>
              <p className="text-xs opacity-70">try a different fragment</p>
            </div>
          ) : (
            results.map((row, i) => (
              <button
                key={row.path}
                onClick={() => handleSelect(row.path)}
                className={clsx(
                  'w-full flex items-start gap-3 px-4 py-2 text-left',
                  i === selected
                    ? 'bg-accent/12 text-text-primary border-l-2 border-accent'
                    : 'text-text-secondary hover:bg-surface-hover border-l-2 border-transparent',
                )}
              >
                <FileText size={14} className="shrink-0 text-text-muted mt-0.5" />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-sm font-medium truncate">{row.title}</span>
                    <SourceBadge sources={row.sources} />
                  </div>
                  <div className="text-xs text-text-muted truncate">
                    {row.snippet || row.path}
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function SourceBadge({ sources }: { sources: number }) {
  const isKeyword = (sources & 1) !== 0;
  const isSemantic = (sources & 2) !== 0;
  if (isKeyword && isSemantic) {
    return (
      <span className="text-[10px] uppercase tracking-wide text-accent shrink-0">
        name + content
      </span>
    );
  }
  if (isSemantic) {
    return (
      <span className="text-[10px] uppercase tracking-wide text-text-muted shrink-0 inline-flex items-center gap-0.5">
        <Sparkles size={9} /> content
      </span>
    );
  }
  // Keyword-only is the default; no badge needed — the title already
  // tells the user why it matched.
  return null;
}

function trimSnippet(s: string): string {
  const collapsed = s.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= 120) return collapsed;
  return collapsed.slice(0, 117) + '…';
}
