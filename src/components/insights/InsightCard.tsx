import { useState } from 'react';
import { clsx } from 'clsx';
import {
  Link as LinkIcon,
  GitBranch,
  Sparkles,
  X,
  ExternalLink,
  Info,
} from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useVaultStore } from '@/stores/vault';
import type { Insight, InsightAction, InsightKind } from '@/stores/insights';
import { useInsightsStore } from '@/stores/insights';
import { appendToEditor } from '@/lib/editor-registry';
import { ResolveDuplicateDialog } from './ResolveDuplicateDialog';

const KIND_META: Record<InsightKind, { label: string; icon: typeof LinkIcon }> = {
  missing_wikilink:    { label: 'Missing wikilink',    icon: LinkIcon },
  bridge_candidate:    { label: 'Bridge candidate',    icon: GitBranch },
  resurfacing:         { label: 'Resurface',           icon: Sparkles },
  today_companion:     { label: 'Today',               icon: Sparkles },
  question_answered:   { label: 'Question answered',   icon: Sparkles },
  news_for_theme:      { label: 'News',                icon: Sparkles },
  echo:                { label: 'Echo',                icon: Sparkles },
  stranded_note:       { label: 'Stranded note',       icon: Sparkles },
  emerging_theme:      { label: 'Emerging theme',      icon: Sparkles },
  problem_researched:  { label: 'Research',            icon: Sparkles },
  idea_state_of_art:   { label: 'State of the art',    icon: Sparkles },
};

/// Human-readable action label. Kept here (not in the store) so a designer
/// can reword without touching the data layer.
function actionLabel(a: InsightAction): string {
  switch (a.type) {
    case 'open_note':                 return 'Open';
    case 'open_side_by_side':         return 'Open both';
    case 'insert_wikilink':           return 'Insert link';
    case 'create_note_from_template': return 'Create note';
    case 'open_external':             return 'Open link';
    case 'resolve_duplicate':         return 'Resolve duplicate';
  }
}

interface Props {
  insight: Insight;
}

export function InsightCard({ insight }: Props) {
  const meta = KIND_META[insight.kind];
  const Icon = meta?.icon ?? Sparkles;
  const dismiss = useInsightsStore((s) => s.dismiss);
  const act = useInsightsStore((s) => s.act);
  const openNote = useVaultStore((s) => s.openNote);
  const [showWhy, setShowWhy] = useState(false);
  // Paths for the duplicate-resolution dialog, or null when it's closed.
  const [dupPaths, setDupPaths] = useState<string[] | null>(null);

  const runAction = async (a: InsightAction) => {
    switch (a.type) {
      // Navigation actions just open notes/links. They are NOT "resolving"
      // the insight, so they must not mark it acted — opening a note to
      // look at it shouldn't make the card vanish from the inbox.
      case 'open_note':
        await openNote(a.note_path).catch(console.error);
        break;
      case 'open_side_by_side':
        // No real split-view yet; open them in sequence so both land in the
        // tab strip and the user can flip between them.
        for (const p of a.note_paths) {
          await openNote(p).catch(console.error);
        }
        break;
      case 'open_external':
        try {
          const { openUrl } = await import('@tauri-apps/plugin-opener');
          await openUrl(a.url);
        } catch (e) {
          console.error('Failed to open url', e);
        }
        break;

      // Resolving actions: they change the vault, so they DO mark the
      // insight acted and remove the card.
      case 'insert_wikilink': {
        const inserted = await insertWikilink(a.source, a.target);
        if (inserted) await act(insight.id);
        break;
      }
      case 'resolve_duplicate':
        // Opens the picker dialog. The insight is only marked acted once a
        // note is actually deleted — see the dialog's onResolved below.
        setDupPaths(a.note_paths);
        break;
      case 'create_note_from_template':
        // Still surface-only — the template engine lands in a later phase.
        console.info('create_note_from_template not implemented yet');
        break;
    }
  };

  /// Open the source note and append `[[target]]` to it. Returns true once
  /// the link landed. The editor mounts asynchronously after `openNote`, so
  /// we retry `appendToEditor` for a short window before giving up.
  const insertWikilink = async (
    source: string,
    target: string,
  ): Promise<boolean> => {
    try {
      await openNote(source);
    } catch (e) {
      console.error('Failed to open note for wikilink insert', e);
      return false;
    }
    const link = `[[${target}]]`;
    for (let attempt = 0; attempt < 25; attempt++) {
      if (appendToEditor(source, link)) return true;
      await new Promise((r) => setTimeout(r, 40));
    }
    console.error('Editor for', source, 'never mounted — wikilink not inserted');
    return false;
  };

  return (
    <div className="rounded-md border border-border bg-surface-1 p-2.5 space-y-2 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <Icon size={12} className="shrink-0 text-accent" />
          <span className="text-text-primary font-medium truncate">
            {meta?.label ?? insight.kind}
          </span>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <span
            className="text-[10px] tabular-nums text-text-muted"
            title="Detector confidence"
          >
            {insight.confidence.toFixed(2)}
          </span>
          <button
            type="button"
            onClick={() => setShowWhy((v) => !v)}
            className={clsx(
              'p-0.5 rounded',
              showWhy
                ? 'text-text-primary bg-surface-hover'
                : 'text-text-muted hover:text-text-primary',
            )}
            title="Why did I see this?"
          >
            <Info size={11} />
          </button>
          <button
            type="button"
            onClick={() => void dismiss(insight.id)}
            className="p-0.5 rounded text-text-muted hover:text-text-primary"
            title="Dismiss (won't show again for the configured cooldown)"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {insight.title && (
        <div className="text-text-primary font-medium">{insight.title}</div>
      )}
      <p className="text-text-secondary whitespace-pre-wrap leading-relaxed">
        {insight.body}
      </p>

      {showWhy && (
        <div className="rounded border border-border bg-surface-0 px-2 py-1.5 text-[11px] text-text-muted space-y-0.5">
          <div>Notes: {insight.note_paths.join(', ') || '—'}</div>
          <div>Generated: {new Date(insight.generated_at * 1000).toLocaleString()}</div>
          <div>Kind: {insight.kind}</div>
        </div>
      )}

      {insight.external_refs.length > 0 && (
        <div className="space-y-1">
          {insight.external_refs.map((r) => (
            <a
              key={r.url}
              href={r.url}
              onClick={(e) => {
                e.preventDefault();
                invoke('open_external', { url: r.url }).catch(() => {
                  // The shell-opener plugin is the real path — falling back
                  // to a no-op is fine, we don't want a broken link to crash.
                });
              }}
              className="flex items-start gap-1 text-accent hover:underline"
            >
              <ExternalLink size={10} className="mt-[3px] shrink-0" />
              <span className="truncate">{r.title || r.url}</span>
            </a>
          ))}
        </div>
      )}

      {insight.actions.length > 0 && (
        <div className="flex flex-wrap gap-1.5 pt-0.5">
          {insight.actions.map((a, idx) => (
            <button
              key={idx}
              type="button"
              onClick={() => void runAction(a)}
              className="px-2 py-0.5 rounded border border-border bg-surface-0 text-text-primary hover:bg-surface-hover text-[11px]"
            >
              {actionLabel(a)}
            </button>
          ))}
        </div>
      )}

      {dupPaths && (
        <ResolveDuplicateDialog
          paths={dupPaths}
          onClose={() => setDupPaths(null)}
          onResolved={() => {
            setDupPaths(null);
            void act(insight.id);
          }}
        />
      )}
    </div>
  );
}
