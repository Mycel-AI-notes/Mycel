import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useVaultStore } from '@/stores/vault';
import { useUIStore } from '@/stores/ui';
import { useAiStore } from '@/stores/ai';
import { clsx } from 'clsx';
import {
  ExternalLink as ExtLinkIcon,
  FileText,
  Folder,
  Link as LinkIcon,
  Link2,
  Sparkles,
} from 'lucide-react';
import { DisconnectedSpore } from '@/components/brand/Spore';
import { TagSearch } from '@/components/search/TagSearch';
import { insertAtCursor, scrollEditorToLine } from '@/lib/editor-registry';
import { parseExternalLinks } from '@/lib/markdown-parse';
import { displayName, isEncryptedPath } from '@/lib/note-name';
import { InsightsPanel } from '@/components/insights/InsightsPanel';
import { useInsightsStore } from '@/stores/insights';

interface Backlink {
  path: string;
  title: string;
  context: string;
  folder: string;
}

interface RelatedHit {
  note_path: string;
  distance: number;
}

export function RightPanel() {
  const { rightPanelTab, setRightPanelTab } = useUIStore();
  const { activeTabPath, noteCache, openNote, vaultVersion } = useVaultStore();
  const aiStatus = useAiStore((s) => s.status);
  const aiIndex = useAiStore((s) => s.indexStatus);
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);
  const [related, setRelated] = useState<RelatedHit[]>([]);
  const [tagQuery, setTagQuery] = useState<string | null>(null);

  const note = activeTabPath ? noteCache.get(activeTabPath) : null;

  // Related is only meaningful when AI is on, indexed, and we're looking
  // at a plaintext note (encrypted notes are never embedded). Gating
  // here keeps the panel from briefly showing "no related notes" for
  // setups where the feature simply doesn't apply.
  const relatedEligible =
    !!aiStatus?.enabled &&
    !!aiStatus?.has_key &&
    (aiIndex?.chunks_indexed ?? 0) > 0 &&
    !!activeTabPath &&
    !isEncryptedPath(activeTabPath);

  // Insights tab is only present when the engine is enabled — that's the
  // "silently degrades" rule. We pull the flag from the insights store
  // (which the Settings page populates on mount) and from a one-shot fetch
  // here so the tab appears in fresh sessions too.
  const insightsStatus = useInsightsStore((s) => s.status);
  const loadInsightsStatus = useInsightsStore((s) => s.loadStatus);
  useEffect(() => {
    void loadInsightsStatus();
  }, [loadInsightsStatus]);
  const insightsEnabled = !!insightsStatus?.settings.enabled;

  const tabs = insightsEnabled
    ? (['outline', 'backlinks', 'tags', 'insights'] as const)
    : (['outline', 'backlinks', 'tags'] as const);

  // If the user toggles Insights off while the tab is active, fall back to
  // backlinks so the panel never renders a hidden tab's content.
  useEffect(() => {
    if (!insightsEnabled && rightPanelTab === 'insights') {
      setRightPanelTab('backlinks');
    }
  }, [insightsEnabled, rightPanelTab, setRightPanelTab]);

  // Re-fetch backlinks on tab open, on note switch, and after any save in the
  // vault (vaultVersion bumps). Edits-in-progress don't trigger it — backlinks
  // only become valid once the linking note is persisted to disk.
  useEffect(() => {
    if (!activeTabPath || rightPanelTab !== 'backlinks') return;
    let cancelled = false;
    invoke<Backlink[]>('backlinks_get', { path: activeTabPath })
      .then((res) => {
        if (!cancelled) setBacklinks(res);
      })
      .catch(console.error);
    return () => {
      cancelled = true;
    };
  }, [activeTabPath, rightPanelTab, vaultVersion]);

  // Related neighbors. Refetch on note switch and when the backlinks
  // tab opens. We deliberately don't subscribe to `vaultVersion`: the
  // auto-indexer runs 5s after a save, so the chunks fresh enough to
  // shift neighbor rankings aren't even in the DB yet on save. The
  // related list will refresh next time the user switches notes and
  // comes back.
  useEffect(() => {
    if (!relatedEligible || rightPanelTab !== 'backlinks') {
      setRelated([]);
      return;
    }
    let cancelled = false;
    invoke<RelatedHit[]>('ai_find_related', {
      args: { path: activeTabPath, k: 5 },
    })
      .then((res) => {
        if (!cancelled) setRelated(res);
      })
      .catch(() => {
        // Silent: the panel is a nicety; an error toast on every note
        // switch would be obnoxious.
        if (!cancelled) setRelated([]);
      });
    return () => {
      cancelled = true;
    };
  }, [activeTabPath, rightPanelTab, relatedEligible]);

  const mergedTags = note
    ? Array.from(
        new Set([...(note.parsed.meta.tags ?? []), ...note.parsed.tags]),
      )
    : [];

  const outgoingWikilinks = useMemo(() => {
    if (!note) return [] as { target: string; alias?: string }[];
    const seen = new Set<string>();
    const out: { target: string; alias?: string }[] = [];
    for (const wl of note.parsed.wikilinks) {
      if (wl.is_embed) continue;
      const key = wl.target.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ target: wl.target, alias: wl.alias });
    }
    return out;
  }, [note]);

  const externalLinks = useMemo(
    () => (note ? parseExternalLinks(note.content) : []),
    [note],
  );

  const openWikilink = (target: string) => {
    // Strip optional `.md` extension and heading anchor — `[[Note#section]]`.
    const cleaned = target.split('#')[0].replace(/\.md$/i, '').trim();
    if (!cleaned) return;
    const candidate = cleaned.endsWith('.md') ? cleaned : `${cleaned}.md`;
    openNote(candidate).catch((e) => console.error('Failed to open wikilink', e));
  };

  return (
    <aside className="flex flex-col h-full bg-surface-0 border-l border-border w-52 shrink-0 text-sm">
      <div className="flex border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab}
            onClick={() => setRightPanelTab(tab)}
            className={clsx(
              'flex-1 py-1.5 text-xs capitalize',
              rightPanelTab === tab
                ? 'text-text-primary border-b-2 border-accent'
                : 'text-text-muted hover:text-text-secondary',
            )}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {rightPanelTab === 'outline' && note && (
          <ul className="space-y-0.5">
            {note.parsed.headings.map((h, i) => (
              <li key={i}>
                <button
                  type="button"
                  onClick={() => {
                    if (activeTabPath && typeof h.line === 'number') {
                      scrollEditorToLine(activeTabPath, h.line);
                    }
                  }}
                  disabled={typeof h.line !== 'number'}
                  className="block w-full text-left text-text-secondary hover:text-text-primary truncate py-0.5 disabled:cursor-not-allowed"
                  style={{ paddingLeft: `${(h.level - 1) * 12}px` }}
                  title={h.text}
                >
                  <span className="text-text-muted mr-1">{'#'.repeat(h.level)}</span>
                  {h.text}
                </button>
              </li>
            ))}
            {note.parsed.headings.length === 0 && (
              <p className="text-text-muted text-xs">No headings</p>
            )}
          </ul>
        )}

        {rightPanelTab === 'backlinks' && (
          <div className="space-y-4">
            <section>
              <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-1.5">
                Incoming ({backlinks.length})
              </h4>
              {backlinks.length === 0 ? (
                <div className="flex flex-col items-center gap-1.5 py-4 text-text-muted">
                  <DisconnectedSpore size={24} className="text-accent-muted/80" />
                  <p className="text-xs">
                    {activeTabPath ? 'No backlinks' : 'Open a note to see backlinks'}
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {backlinks.map((bl) => (
                    <button
                      key={bl.path}
                      onClick={() => openNote(bl.path)}
                      className="w-full text-left group"
                      title={bl.path}
                    >
                      <div className="flex items-center gap-1.5 text-text-secondary group-hover:text-text-primary">
                        <FileText size={11} className="shrink-0 text-text-muted" />
                        <span className="text-xs font-medium truncate">{bl.title}</span>
                      </div>
                      {bl.folder && (
                        <div className="flex items-center gap-1 pl-4 mt-0.5 text-[10px] text-text-muted">
                          <Folder size={9} className="shrink-0" />
                          <span className="truncate">{bl.folder}</span>
                        </div>
                      )}
                      {bl.context && (
                        <p className="text-xs text-text-muted mt-0.5 line-clamp-2 pl-4">
                          {bl.context}
                        </p>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </section>

            {note && outgoingWikilinks.length > 0 && (
              <section>
                <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-1.5">
                  Outgoing ({outgoingWikilinks.length})
                </h4>
                <div className="space-y-1">
                  {outgoingWikilinks.map((wl) => (
                    <button
                      key={wl.target}
                      onClick={() => openWikilink(wl.target)}
                      className="w-full text-left group flex items-center gap-1.5 text-text-secondary hover:text-text-primary"
                      title={wl.target}
                    >
                      <LinkIcon size={11} className="shrink-0 text-text-muted" />
                      <span className="text-xs truncate">
                        {wl.alias ?? wl.target}
                      </span>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {note && externalLinks.length > 0 && (
              <section>
                <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-1.5">
                  External ({externalLinks.length})
                </h4>
                <div className="space-y-1">
                  {externalLinks.map((lnk) => (
                    <button
                      key={lnk.url}
                      onClick={() =>
                        openUrl(lnk.url).catch((e) =>
                          console.error('Failed to open url', e),
                        )
                      }
                      className="w-full text-left group flex items-start gap-1.5 text-text-secondary hover:text-text-primary"
                      title={lnk.url}
                    >
                      <ExtLinkIcon
                        size={11}
                        className="shrink-0 text-text-muted mt-0.5"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-xs truncate">{lnk.label}</div>
                        {lnk.label !== lnk.url && (
                          <div className="text-[10px] text-text-muted truncate">
                            {lnk.url}
                          </div>
                        )}
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            )}

            {relatedEligible && related.length > 0 && activeTabPath && (
              <RelatedSection
                hits={related}
                onOpen={(path) => openNote(path)}
                onInsertLink={(path) => {
                  insertAtCursor(activeTabPath, `[[${displayName(path)}]]`);
                }}
              />
            )}
          </div>
        )}

        {rightPanelTab === 'tags' && note && (
          <div className="flex flex-wrap gap-1">
            {mergedTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setTagQuery(tag)}
                className="px-2 py-0.5 rounded-full border border-tag/30 bg-tag/10 text-tag text-xs hover:bg-tag/20 hover:border-tag/60 transition-colors cursor-pointer"
                title={`Find all notes tagged #${tag}`}
              >
                #{tag}
              </button>
            ))}
            {mergedTags.length === 0 && (
              <p className="text-text-muted text-xs">No tags</p>
            )}
          </div>
        )}

        {rightPanelTab === 'insights' && insightsEnabled && <InsightsPanel />}

        {!note && rightPanelTab !== 'backlinks' && rightPanelTab !== 'insights' && (
          <p className="text-text-muted text-xs">Open a note to see details</p>
        )}
      </div>

      {tagQuery && <TagSearch tag={tagQuery} onClose={() => setTagQuery(null)} />}
    </aside>
  );
}

/// Related notes section. Computes a per-row "confidence bar" by
/// normalizing the cosine distances to the range observed in the current
/// list — so the best neighbor always pegs the bar and the rest are
/// shown relative to it. Absolute distances would yield bars that all
/// look the same (real-world embedding distances tend to cluster in a
/// narrow band).
function RelatedSection({
  hits,
  onOpen,
  onInsertLink,
}: {
  hits: RelatedHit[];
  onOpen: (path: string) => void;
  onInsertLink: (path: string) => void;
}) {
  const min = hits.reduce((a, b) => Math.min(a, b.distance), hits[0].distance);
  const max = hits.reduce((a, b) => Math.max(a, b.distance), hits[0].distance);
  const range = Math.max(max - min, 1e-6);

  const widthFor = (d: number) => {
    // Best (smallest distance) → 100%, worst → 35%. Floor keeps every
    // row's bar visible enough to read; without it the bottom hits
    // collapse to zero-width and look like nothing matched.
    const norm = 1 - (d - min) / range;
    return 35 + norm * 65;
  };

  return (
    <section>
      <h4 className="text-[10px] uppercase tracking-wider text-text-muted mb-1.5 flex items-center gap-1">
        <Sparkles size={9} className="text-accent" />
        Related ({hits.length})
      </h4>
      <div className="space-y-1.5">
        {hits.map((h) => (
          // A nested <button> inside the title <button> would be invalid
          // HTML, so each row is a <div> with two separate buttons
          // inside: title (opens the note) and link-insert (drops a
          // wikilink into the active editor).
          <div
            key={h.note_path}
            className="group"
            title={h.note_path}
          >
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => onOpen(h.note_path)}
                className="flex-1 min-w-0 flex items-center gap-1.5 text-left text-text-secondary group-hover:text-text-primary"
              >
                <FileText size={11} className="shrink-0 text-text-muted" />
                <span className="text-xs font-medium truncate">
                  {displayName(h.note_path)}
                </span>
              </button>
              <button
                type="button"
                onClick={() => onInsertLink(h.note_path)}
                className="shrink-0 p-1 rounded text-text-muted hover:text-text-primary hover:bg-surface-hover opacity-0 group-hover:opacity-100 focus:opacity-100"
                title="Insert wikilink at cursor"
                aria-label="Insert wikilink at cursor"
              >
                <Link2 size={11} />
              </button>
            </div>
            <div className="pl-4 mt-0.5">
              <div className="h-1 rounded-full bg-surface-0 overflow-hidden">
                <div
                  className="h-full bg-accent/70"
                  style={{ width: `${widthFor(h.distance)}%` }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
