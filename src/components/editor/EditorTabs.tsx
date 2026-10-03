import {
  X,
  Lock,
  Inbox,
  Zap,
  ClipboardList,
  Hourglass,
  Lightbulb,
  RefreshCw,
  Sparkles,
  type LucideIcon,
} from 'lucide-react';
import { clsx } from 'clsx';
import { useVaultStore } from '@/stores/vault';
import { PulseSpore } from '@/components/brand/Spore';
import { isEncryptedPath } from '@/lib/note-name';
import { parseGardenTabPath } from '@/lib/garden-tab';
import { isInsightsTabPath } from '@/lib/insights-tab';
import { pageIconOf } from '@/lib/page-meta';
import { PageIcon } from '@/components/page/PageIcon';

/// Icon for a synthetic (non-note) tab — Garden views and the Insights
/// inbox. Returns null for ordinary note paths.
function syntheticTabIcon(path: string): LucideIcon | null {
  if (isInsightsTabPath(path)) return Sparkles;
  const view = parseGardenTabPath(path);
  if (!view) return null;
  switch (view.kind) {
    case 'inbox': return Inbox;
    case 'actions': return Zap;
    case 'projects':
    case 'project-detail': return ClipboardList;
    case 'waiting': return Hourglass;
    case 'someday': return Lightbulb;
    case 'review': return RefreshCw;
  }
}

export function EditorTabs() {
  const { openTabs, activeTabPath, setActiveTab, closeTab, pinTab, noteCache } = useVaultStore();

  if (openTabs.length === 0) return null;

  return (
    <div className="flex items-center gap-1 px-2 pt-1.5 pb-1 bg-surface-1 overflow-x-auto shrink-0">
      {openTabs.map((tab) => {
        const SyntheticIcon = syntheticTabIcon(tab.path);
        const content = noteCache.get(tab.path)?.content;
        const pageIcon = !SyntheticIcon && content ? pageIconOf(content) : null;
        return (
        <button
          key={tab.path}
          onClick={() => setActiveTab(tab.path)}
          onDoubleClick={() => pinTab(tab.path)}
          title={tab.isPreview ? 'Preview tab — double-click or save to pin' : tab.path}
          className={clsx(
            'flex items-center gap-1.5 pl-3 pr-1.5 py-1 text-[13px] rounded-lg shrink-0 max-w-[200px] group transition-[color,background-color,box-shadow]',
            tab.path === activeTabPath
              ? 'myc-selected'
              : 'text-text-muted hover:text-text-secondary hover:bg-surface-2',
            tab.isPreview && 'italic',
          )}
        >
          {SyntheticIcon && (
            <SyntheticIcon
              size={12}
              className="shrink-0 text-accent"
              aria-hidden="true"
            />
          )}
          {pageIcon && <PageIcon icon={pageIcon.icon} color={pageIcon.color} size={12} />}
          {isEncryptedPath(tab.path) && (
            <Lock
              size={10}
              className="shrink-0 text-accent"
              aria-label="Encrypted note"
            />
          )}
          <span className="truncate">{tab.title}</span>
          {tab.isDirty && (
            <PulseSpore size={9} className="text-accent" />
          )}
          <span
            role="button"
            onClick={(e) => {
              e.stopPropagation();
              closeTab(tab.path);
            }}
            className={clsx(
              'p-0.5 rounded-full hover:bg-surface-2 shrink-0',
              tab.isDirty
                ? 'opacity-100'
                : 'opacity-0 group-hover:opacity-100',
            )}
          >
            <X size={11} />
          </span>
        </button>
        );
      })}
    </div>
  );
}
