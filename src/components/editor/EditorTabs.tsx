import { X } from 'lucide-react';
import { clsx } from 'clsx';
import { useVaultStore } from '@/stores/vault';

export function EditorTabs() {
  const { openTabs, activeTabPath, setActiveTab, closeTab } = useVaultStore();

  if (openTabs.length === 0) return null;

  return (
    <div className="flex items-center border-b border-border bg-surface-0 overflow-x-auto shrink-0">
      {openTabs.map((tab) => (
        <button
          key={tab.path}
          onClick={() => setActiveTab(tab.path)}
          className={clsx(
            'flex items-center gap-1.5 px-3 py-1.5 text-sm border-r border-border shrink-0 max-w-[180px] group',
            tab.path === activeTabPath
              ? 'bg-surface-1 text-text-primary'
              : 'text-text-muted hover:text-text-secondary hover:bg-surface-1/50',
          )}
        >
          <span className="truncate">{tab.title}</span>
          {tab.isDirty && <span className="text-accent text-xs">●</span>}
          <span
            role="button"
            onClick={(e) => {
              e.stopPropagation();
              closeTab(tab.path);
            }}
            className={clsx(
              'p-0.5 rounded hover:bg-surface-hover shrink-0',
              tab.isDirty
                ? 'opacity-100'
                : 'opacity-0 group-hover:opacity-100',
            )}
          >
            <X size={11} />
          </span>
        </button>
      ))}
    </div>
  );
}
