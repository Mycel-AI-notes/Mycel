import { useVaultStore } from '@/stores/vault';
import { useUIStore } from '@/stores/ui';
import { clsx } from 'clsx';

export function RightPanel() {
  const { rightPanelTab, setRightPanelTab } = useUIStore();
  const { activeTabPath, noteCache } = useVaultStore();

  const note = activeTabPath ? noteCache.get(activeTabPath) : null;

  const tabs = ['outline', 'backlinks', 'tags'] as const;

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
                className="text-text-secondary hover:text-text-primary cursor-pointer truncate"
                style={{ paddingLeft: `${(h.level - 1) * 12}px` }}
              >
                {h.text}
              </li>
            ))}
            {note.parsed.headings.length === 0 && (
              <p className="text-text-muted text-xs">No headings</p>
            )}
          </ul>
        )}

        {rightPanelTab === 'backlinks' && (
          <p className="text-text-muted text-xs">Backlinks coming in Stage 2</p>
        )}

        {rightPanelTab === 'tags' && note && (
          <div className="flex flex-wrap gap-1">
            {[...(note.parsed.meta.tags ?? []), ...note.parsed.tags].map((tag, i) => (
              <span key={i} className="px-2 py-0.5 rounded-full bg-accent/10 text-accent text-xs">
                #{tag}
              </span>
            ))}
            {!note.parsed.meta.tags?.length && !note.parsed.tags.length && (
              <p className="text-text-muted text-xs">No tags</p>
            )}
          </div>
        )}

        {!note && <p className="text-text-muted text-xs">Open a note to see details</p>}
      </div>
    </aside>
  );
}
