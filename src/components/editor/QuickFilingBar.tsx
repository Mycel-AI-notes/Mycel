import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Sparkles, X, FolderInput, PenLine, FilePlus2 } from 'lucide-react';
import { useVaultStore } from '@/stores/vault';
import { displayName } from '@/lib/note-name';
import type { FileEntry } from '@/types';
import { MergeQuickNoteDialog } from '@/components/insights/MergeQuickNoteDialog';

interface TargetHit {
  note_path: string;
  similarity: number;
}

interface Suggestions {
  title: string | null;
  targets: TargetHit[];
  /// New-note proposal from the LLM when nothing existing fits.
  create_path: string | null;
  /// One-line LLM explanation, in the note's language.
  reason: string | null;
  ai_available: boolean;
}

type Phase = 'hidden' | 'thinking' | 'ready';

/// Children names (without extension) of the folder `parent` in the tree —
/// used to keep a suggested rename from colliding with a sibling.
function siblingStems(tree: FileEntry[], parent: string): Set<string> {
  let entries: FileEntry[] = tree;
  for (const seg of parent.split('/')) {
    const next = entries.find((e) => e.is_dir && e.name === seg);
    if (!next) return new Set();
    entries = next.children ?? [];
  }
  return new Set(
    entries.filter((e) => !e.is_dir).map((e) => e.name.replace(/\.md(\.age)?$/, '')),
  );
}

/// The "magic" strip under a quick-note editor. After every save it asks
/// the backend where this thought belongs and offers the answers inline:
/// a human name for the file and the closest notes to merge it into.
/// Renders nothing for non-quick notes (the editor doesn't mount it) and
/// stays hidden until there's something worth suggesting.
export function QuickFilingBar({ path, saveTick }: { path: string; saveTick: number }) {
  const renameNote = useVaultStore((s) => s.renameNote);
  const createNote = useVaultStore((s) => s.createNote);
  const [phase, setPhase] = useState<Phase>('hidden');
  const [sugg, setSugg] = useState<Suggestions | null>(null);
  const [mergeTarget, setMergeTarget] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (saveTick === 0) return;
    let cancelled = false;
    setPhase('thinking');
    invoke<Suggestions>('quick_note_suggest', { path })
      .then((s) => {
        if (cancelled) return;
        if (!s.title && s.targets.length === 0 && !s.create_path) {
          setPhase('hidden');
          return;
        }
        setSugg(s);
        setPhase('ready');
      })
      .catch((e) => {
        console.error('quick_note_suggest failed:', e);
        if (!cancelled) setPhase('hidden');
      });
    return () => {
      cancelled = true;
    };
  }, [saveTick, path]);

  if (phase === 'hidden') return null;

  const rename = async (title: string) => {
    const parent = path.slice(0, path.lastIndexOf('/'));
    const taken = siblingStems(useVaultStore.getState().fileTree, parent);
    let stem = title;
    let n = 2;
    while (taken.has(stem) && n < 100) {
      stem = `${title} ${n}`;
      n++;
    }
    setBusy(true);
    try {
      // The tab follows the rename; this component remounts under the new
      // path with the bar reset — which is right, the suggestion was taken.
      await renameNote(path, `${parent}/${stem}.md`);
    } catch (e) {
      console.error('Rename failed:', e);
      setBusy(false);
    }
  };

  // "Start a new note with this thought": create the (non-destructive)
  // target first, then run it through the same confirmed merge dialog as
  // an existing target — the destructive half stays gated.
  const startNew = async (target: string) => {
    setBusy(true);
    try {
      await createNote(target);
      setMergeTarget(target);
    } catch (e) {
      console.error('Create-note failed:', e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="relative shrink-0 border-t border-border bg-surface-0 px-3 py-2">
      {phase === 'thinking' && <div className="ai-glow-line" />}

      {phase === 'thinking' ? (
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <Sparkles size={13} className="shrink-0 text-accent animate-pulse" />
          <span className="ai-shimmer">Finding a home for this thought…</span>
        </div>
      ) : (
        sugg && (
          <div className="ai-arrive flex flex-wrap items-center gap-1.5 text-xs">
            <Sparkles size={13} className="shrink-0 text-accent" />
            {sugg.title && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void rename(sugg.title!)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-accent/40 bg-accent/10 text-text-primary hover:bg-accent/20 disabled:opacity-50"
                title="Rename this note"
              >
                <PenLine size={11} className="text-accent" />
                Call it “{sugg.title}”
              </button>
            )}
            {sugg.targets.map((t) => (
              <button
                key={t.note_path}
                type="button"
                disabled={busy}
                onClick={() => setMergeTarget(t.note_path)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-border bg-surface-1 text-text-primary hover:bg-surface-hover disabled:opacity-50"
                title={`${t.note_path} · ${Math.round(t.similarity * 100)}% match`}
              >
                <FolderInput size={11} className="text-accent" />
                Move into “{displayName(t.note_path)}”
              </button>
            ))}
            {sugg.create_path && (
              <button
                type="button"
                disabled={busy}
                onClick={() => void startNew(sugg.create_path!)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full border border-border bg-surface-1 text-text-primary hover:bg-surface-hover disabled:opacity-50"
                title={`Create ${sugg.create_path} and move this note into it`}
              >
                <FilePlus2 size={11} className="text-accent" />
                Start “{displayName(sugg.create_path)}”
              </button>
            )}
            {!sugg.ai_available && (
              <span className="text-[11px] text-text-muted">
                Add an OpenRouter key in Settings → AI to get “move into” suggestions.
              </span>
            )}
            <button
              type="button"
              onClick={() => setPhase('hidden')}
              className="ml-auto p-0.5 rounded text-text-muted hover:text-text-primary"
              title="Dismiss until the next save"
            >
              <X size={12} />
            </button>
            {sugg.reason && (
              <span className="basis-full pl-[19px] text-[11px] text-text-muted">
                {sugg.reason}
              </span>
            )}
          </div>
        )
      )}

      {mergeTarget && (
        <MergeQuickNoteDialog
          source={path}
          target={mergeTarget}
          onClose={() => setMergeTarget(null)}
          onResolved={() => {
            setMergeTarget(null);
            setPhase('hidden');
          }}
        />
      )}
    </div>
  );
}
