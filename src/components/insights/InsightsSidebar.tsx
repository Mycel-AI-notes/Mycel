import { useEffect } from 'react';
import { clsx } from 'clsx';
import { Sparkles } from 'lucide-react';
import { useVaultStore } from '@/stores/vault';
import { useInsightsStore } from '@/stores/insights';
import { isInsightsTabPath } from '@/lib/insights-tab';

/// Left-sidebar entry that opens the full-page Insights inbox.
///
/// Self-gating: renders nothing until `loadStatus` confirms the engine is
/// enabled. That keeps the "silently degrades" rule local — `Sidebar` mounts
/// this unconditionally and this component decides whether to show itself.
export function InsightsSidebar() {
  const status = useInsightsStore((s) => s.status);
  const loadStatus = useInsightsStore((s) => s.loadStatus);
  const activeTabPath = useVaultStore((s) => s.activeTabPath);
  const openInsightsTab = useVaultStore((s) => s.openInsightsTab);

  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);

  if (!status?.settings.enabled) return null;

  const active = isInsightsTabPath(activeTabPath);
  const count = status.pending_count;

  return (
    <div className="border-b border-border bg-surface-0 px-2 py-1.5">
      <button
        type="button"
        onClick={() => openInsightsTab({ preview: true })}
        className={clsx(
          'w-full flex items-center gap-2 px-1 py-0.5 rounded text-xs font-semibold uppercase tracking-wider transition-colors',
          active
            ? 'text-accent'
            : 'text-text-muted hover:text-text-primary',
        )}
        title="Open the Insights inbox"
      >
        <Sparkles size={13} className="text-accent" />
        <span className="flex-1 text-left">Insights</span>
        {count > 0 && (
          <span className="text-[11px] tabular-nums px-1.5 py-0.5 rounded bg-accent/15 text-accent normal-case tracking-normal">
            {count}
          </span>
        )}
      </button>
    </div>
  );
}
