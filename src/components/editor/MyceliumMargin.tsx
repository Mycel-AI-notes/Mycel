import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import type { EditorView } from '@codemirror/view';
import { useAiStore } from '@/stores/ai';
import { useVaultStore } from '@/stores/vault';
import { isEncryptedPath } from '@/lib/note-name';
import { listNotes } from './WikilinkNavigation';

/**
 * The mycelium margin: a quiet list in the editor's corner of notes close
 * in meaning to the one being written, that it does not link to yet. Click
 * threads a `[[link]]` in at the cursor; ⌘/Ctrl-click opens the note.
 *
 * Only exists when semantic search does (AI on, key set, index built), and
 * refreshes on open and after a pause in typing — the indexer re-embeds a
 * note a few seconds after it is saved, so asking sooner changes nothing.
 */

interface RelatedHit {
  note_path: string;
  distance: number;
}

interface Suggestion {
  path: string;
  title: string;
}

const SHOW = 3;
/** After the last edit: autosave + the indexer's own debounce + slack. */
const REFRESH_AFTER_EDIT_MS = 9000;

interface Props {
  path: string;
  view: () => EditorView | null;
  /** Subscribe to edits; returns the unsubscribe. Drives the refresh. */
  onEdit: (fn: () => void) => () => void;
}

export function MyceliumMargin({ path, view, onEdit }: Props) {
  const aiStatus = useAiStore((s) => s.status);
  const aiIndex = useAiStore((s) => s.indexStatus);
  const openNote = useVaultStore((s) => s.openNote);
  const [items, setItems] = useState<Suggestion[]>([]);
  const [refresh, setRefresh] = useState(0);

  const eligible =
    !!aiStatus?.enabled &&
    !!aiStatus?.has_key &&
    (aiIndex?.chunks_indexed ?? 0) > 0 &&
    !isEncryptedPath(path);

  // Debounced refresh after typing stops.
  useEffect(() => {
    if (!eligible) return;
    let t: ReturnType<typeof setTimeout> | undefined;
    const off = onEdit(() => {
      clearTimeout(t);
      t = setTimeout(() => setRefresh((n) => n + 1), REFRESH_AFTER_EDIT_MS);
    });
    return () => {
      off();
      clearTimeout(t);
    };
  }, [onEdit, eligible]);

  useEffect(() => {
    if (!eligible) {
      setItems([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [hits, notes] = await Promise.all([
          invoke<RelatedHit[]>('ai_find_related', { args: { path, k: 8 } }),
          listNotes(),
        ]);
        if (cancelled) return;
        const titles = new Map(notes.map((n) => [n.path, n.title]));
        const text = (view()?.state.doc.toString() ?? '').toLowerCase();
        const next: Suggestion[] = [];
        for (const h of hits ?? []) {
          const title = titles.get(h.note_path);
          if (!title || h.note_path === path) continue;
          // Already threaded in — nothing to suggest.
          if (text.includes(`[[${title.toLowerCase()}`)) continue;
          next.push({ path: h.note_path, title });
          if (next.length === SHOW) break;
        }
        setItems(next);
      } catch {
        // A nicety, not a feature to error about.
        if (!cancelled) setItems([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [path, eligible, refresh, view]);

  if (items.length === 0) return null;

  const link = (title: string) => {
    const v = view();
    if (!v) return;
    const insert = `[[${title}]]`;
    const pos = v.state.selection.main.head;
    v.dispatch({
      changes: { from: pos, insert },
      selection: { anchor: pos + insert.length },
      userEvent: 'input.complete',
    });
    v.focus();
    setItems((xs) => xs.filter((x) => x.title !== title));
  };

  return (
    <aside
      aria-label="Related notes"
      className="absolute bottom-4 right-4 z-10 w-52 opacity-55 hover:opacity-100 transition-opacity myc-fade-in"
    >
      <div className="px-2 pb-1 text-[10px] uppercase tracking-wider text-text-muted">
        Grows toward
      </div>
      <ul className="flex flex-col">
        {items.map((s) => (
          <li key={s.path}>
            <button
              onClick={(e) => {
                if (e.metaKey || e.ctrlKey) openNote(s.path);
                else link(s.title);
              }}
              title="Click to link here · ⌘/Ctrl-click to open"
              className="group w-full flex items-center gap-2 px-2 py-1 rounded text-left text-xs text-text-secondary hover:bg-surface-hover hover:text-text-primary"
            >
              <span className="relative w-3 h-3 shrink-0 flex items-center justify-center">
                <span className="absolute left-0 right-1/2 top-1/2 h-px bg-accent/50" />
                <span className="w-1.5 h-1.5 rounded-full bg-accent shadow-glow-sm" />
              </span>
              <span className="truncate flex-1">{s.title}</span>
              <span className="text-[10px] text-accent opacity-0 group-hover:opacity-100">+ link</span>
            </button>
          </li>
        ))}
      </ul>
    </aside>
  );
}
