import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useVaultStore } from '@/stores/vault';
import { useUIStore } from '@/stores/ui';
import { clsx } from 'clsx';
import { FileText } from 'lucide-react';
import { DisconnectedSpore } from '@/components/brand/Spore';

interface Backlink {
  path: string;
  title: string;
  context: string;
}

export function RightPanel() {
  const { rightPanelTab, setRightPanelTab } = useUIStore();
  const { activeTabPath, noteCache, openNote } = useVaultStore();
  const [backlinks, setBacklinks] = useState<Backlink[]>([]);

  const note = activeTabPath ? noteCache.get(activeTabPath) : null;

  const tabs = ['outline', 'backlinks', 'tags'] as const;

  useEffect(() => {
    if (!activeTabPath || rightPanelTab !== 'backlinks') return;
    setBacklinks([]);
    invoke<Backlink[]>('backlinks_get', { path: activeTabPath })
      .then(setBacklinks)
      .catch(console.error);
  }, [activeTabPath, rightPanelTab]);

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
              <li
                key={i}
                className="text-text-secondary hover:text-text-primary cursor-pointer truncate py-0.5"
                style={{ paddingLeft: `${(h.level - 1) * 12}px` }}
              >
                <span className="text-text-muted mr-1">{'#'.repeat(h.level)}</span>
                {h.text}
              </li>
            ))}
            {note.parsed.headings.length === 0 && (
              <p className="text-text-muted text-xs">No headings</p>
            )}
          </ul>
        )}

        {rightPanelTab === 'backlinks' && (
          <div className="space-y-2">
            {backlinks.length === 0 ? (
              <div className="flex flex-col items-center gap-1.5 py-6 text-text-muted">
                <DisconnectedSpore size={28} className="text-accent-muted/80" />
                <p className="text-xs">
                  {activeTabPath ? 'No backlinks' : 'Open a note to see backlinks'}
                </p>
              </div>
            ) : (
              backlinks.map((bl) => (
                <button
                  key={bl.path}
                  onClick={() => openNote(bl.path)}
                  className="w-full text-left group"
                >
                  <div className="flex items-center gap-1.5 text-text-secondary group-hover:text-text-primary">
                    <FileText size={11} className="shrink-0 text-text-muted" />
                    <span className="text-xs font-medium truncate">{bl.title}</span>
                  </div>
                  {bl.context && (
                    <p className="text-xs text-text-muted mt-0.5 line-clamp-2 pl-4">
                      {bl.context}
                    </p>
                  )}
                </button>
              ))
            )}
          </div>
        )}

        {rightPanelTab === 'tags' && note && (
          <div className="flex flex-wrap gap-1">
            {[...(note.parsed.meta.tags ?? []), ...note.parsed.tags].map((tag, i) => (
              <span
                key={i}
                className="px-2 py-0.5 rounded-full border border-tag/30 bg-tag/10 text-tag text-xs"
              >
                #{tag}
              </span>
            ))}
            {!note.parsed.meta.tags?.length && !note.parsed.tags.length && (
              <p className="text-text-muted text-xs">No tags</p>
            )}
          </div>
        )}

        {!note && rightPanelTab !== 'backlinks' && (
          <p className="text-text-muted text-xs">Open a note to see details</p>
        )}
      </div>
    </aside>
  );
}
