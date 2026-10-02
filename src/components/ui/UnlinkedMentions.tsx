import { useCallback, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ChevronDown, ChevronRight, FileText, Link2, Loader2 } from 'lucide-react';
import { useVaultStore } from '@/stores/vault';
import { describeError, useToastStore } from '@/stores/toast';
import { flushAutosave } from '@/lib/autosave';
import { scrollEditorToLine } from '@/lib/editor-registry';

/** One plain-text mention, as `mentions_unlinked` reports it. */
interface MentionHit {
  /** 1-based file line. */
  line: number;
  /** Byte offset in the line; only ever echoed back to `mention_link`. */
  col: number;
  text: string;
  before: string;
  after: string;
}

interface MentionNote {
  path: string;
  title: string;
  folder: string;
  hits: MentionHit[];
}

/**
 * "Unlinked mentions" under the backlinks: notes that name the active note in
 * plain text without linking it, each mention one click from becoming a
 * `[[link]]`.
 *
 * Collapsed by default and fetched only while open — the lookup reads every
 * candidate note's text, and most of the time the panel is open for the
 * backlinks above it.
 */
export function UnlinkedMentions({
  target,
  refreshKey,
}: {
  target: string;
  /** Changes when the vault settles after saves; triggers a refetch. */
  refreshKey: number;
}) {
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<MentionNote[] | null>(null);
  const [loading, setLoading] = useState(false);
  /** `path` or `path:line:col` of the rewrite in flight. */
  const [busy, setBusy] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);
  const { openNote, reloadNote } = useVaultStore();

  useEffect(() => {
    setNotes(null);
  }, [target]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    invoke<MentionNote[]>('mentions_unlinked', { path: target })
      .then((res) => {
        if (!cancelled) setNotes(res);
      })
      .catch((e) => {
        if (!cancelled) setNotes([]);
        console.error('mentions_unlinked failed', e);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, target, refreshKey, reloadTick]);

  /** Run a rewrite of `source` on disk, with the editor's view of it kept
   *  honest on both sides of the write. */
  const rewrite = useCallback(
    async (source: string, key: string, run: () => Promise<unknown>) => {
      setBusy(key);
      try {
        // The backend edits the file on disk. Words typed in the last second
        // are still only in the editor: write them first, or the rewrite
        // works on an older text and the reload below throws them away.
        await flushAutosave(source);
        const tab = useVaultStore.getState().openTabs.find((t) => t.path === source);
        if (tab?.isDirty) {
          useToastStore
            .getState()
            .error(`Save ${source} first — it has edits that are not on disk yet.`);
          return;
        }
        await run();
        await reloadNote(source).catch(console.error);
      } catch (e) {
        useToastStore.getState().error(describeError(e));
      } finally {
        setBusy(null);
        setReloadTick((t) => t + 1);
      }
    },
    [reloadNote],
  );

  const linkOne = (source: string, hit: MentionHit) =>
    rewrite(source, `${source}:${hit.line}:${hit.col}`, () =>
      invoke('mention_link', {
        source,
        target,
        line: hit.line,
        col: hit.col,
        text: hit.text,
      }),
    );

  const linkAll = (source: string) =>
    rewrite(source, source, () => invoke<number>('mention_link_all', { source, target }));

  const jumpTo = async (path: string, line: number) => {
    await openNote(path).catch(console.error);
    // The editor mounts on the next frame for a note that was not open yet.
    requestAnimationFrame(() => scrollEditorToLine(path, line - 1));
  };

  const total = notes?.reduce((n, note) => n + note.hits.length, 0) ?? 0;

  return (
    <section>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-1 text-[10px] uppercase tracking-wider text-text-muted hover:text-text-secondary mb-1.5"
        aria-expanded={open}
      >
        {open ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
        Unlinked mentions
        {open && notes && ` (${total})`}
        {open && loading && <Loader2 size={9} className="animate-spin ml-1" />}
      </button>

      {open && notes && notes.length === 0 && !loading && (
        <p className="text-xs text-text-muted pl-3">No unlinked mentions</p>
      )}

      {open && notes && notes.length > 0 && (
        <div className="space-y-2.5">
          {notes.map((note) => (
            <div key={note.path} className="group/note">
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => openNote(note.path)}
                  className="flex-1 min-w-0 flex items-center gap-1.5 text-left text-text-secondary hover:text-text-primary"
                  title={note.path}
                >
                  <FileText size={11} className="shrink-0 text-text-muted" />
                  <span className="text-xs font-medium truncate">{note.title}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void linkAll(note.path)}
                  disabled={busy !== null}
                  className="shrink-0 px-1 rounded text-[10px] text-text-muted hover:text-text-primary hover:bg-surface-hover disabled:opacity-50"
                  title={`Link all ${note.hits.length} mention(s) in this note`}
                >
                  {busy === note.path ? <Loader2 size={10} className="animate-spin" /> : 'Link all'}
                </button>
              </div>
              <ul className="mt-0.5 space-y-1">
                {note.hits.map((hit) => {
                  const key = `${note.path}:${hit.line}:${hit.col}`;
                  return (
                    <li key={key} className="group flex items-start gap-1 pl-4">
                      <button
                        type="button"
                        onClick={() => void jumpTo(note.path, hit.line)}
                        className="flex-1 min-w-0 text-left text-xs text-text-muted hover:text-text-secondary"
                        title={`Line ${hit.line}`}
                      >
                        <span className="text-[10px] tabular-nums text-text-muted/70 mr-1">
                          {hit.line}
                        </span>
                        <span className="line-clamp-2 break-words inline">
                          {hit.before}
                          <mark className="bg-accent/25 text-text-primary rounded-sm px-0.5">
                            {hit.text}
                          </mark>
                          {hit.after}
                        </span>
                      </button>
                      <button
                        type="button"
                        onClick={() => void linkOne(note.path, hit)}
                        disabled={busy !== null}
                        className="shrink-0 p-0.5 rounded text-text-muted hover:text-text-primary hover:bg-surface-hover opacity-0 group-hover:opacity-100 focus:opacity-100 disabled:opacity-50"
                        title="Link this mention"
                        aria-label="Link this mention"
                      >
                        {busy === key ? (
                          <Loader2 size={11} className="animate-spin" />
                        ) : (
                          <Link2 size={11} />
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
