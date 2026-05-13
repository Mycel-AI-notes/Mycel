import { useEffect, useMemo } from 'react';
import { Loader2, Play, Settings, Sparkles } from 'lucide-react';
import { clsx } from 'clsx';
import { useInsightsStore, type Insight, type InsightKind } from '@/stores/insights';
import { useUIStore } from '@/stores/ui';
import { InsightCard } from './InsightCard';

/// Inbox rendered inside the right panel's "Insights" tab.
///
/// The panel is mounted by `RightPanel` only when `status.settings.enabled`
/// is true — so when AI is off, this component never even renders. That's
/// the "silently degrades" rule from the spec, enforced one level up.
export function InsightsPanel() {
  const status = useInsightsStore((s) => s.status);
  const insights = useInsightsStore((s) => s.insights);
  const running = useInsightsStore((s) => s.running);
  const lastRun = useInsightsStore((s) => s.lastRun);
  const lastError = useInsightsStore((s) => s.lastError);
  const loadList = useInsightsStore((s) => s.loadList);
  const loadStatus = useInsightsStore((s) => s.loadStatus);
  const runNow = useInsightsStore((s) => s.runNow);
  const openSettings = useUIStore((s) => s.openSettings);

  useEffect(() => {
    void loadStatus();
    void loadList();
  }, [loadStatus, loadList]);

  // Group cards by kind, preserving the (confidence-DESC) order each group
  // arrives in from the backend.
  const groups = useMemo(() => {
    const map = new Map<InsightKind, Insight[]>();
    for (const ins of insights) {
      const arr = map.get(ins.kind) ?? [];
      arr.push(ins);
      map.set(ins.kind, arr);
    }
    return Array.from(map.entries());
  }, [insights]);

  const lastRunLabel = status?.last_run_at
    ? new Date(status.last_run_at * 1000).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  return (
    <div className="flex flex-col gap-2.5">
      <header className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-[11px] text-text-muted">
            {lastRunLabel ? `Last run · ${lastRunLabel}` : 'No runs yet today'}
          </div>
          <div className="text-[11px] text-text-muted">
            Scheduled · {status?.settings.schedule.time ?? '07:00'}
          </div>
        </div>
        <div className="flex gap-1 shrink-0">
          <button
            type="button"
            onClick={() => void runNow()}
            disabled={running}
            title="Run all detectors now"
            className={clsx(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded border border-border bg-surface-0 text-[11px]',
              running
                ? 'text-text-muted cursor-wait'
                : 'text-text-primary hover:bg-surface-hover',
            )}
          >
            {running ? <Loader2 size={11} className="animate-spin" /> : <Play size={11} />}
            <span>Run now</span>
          </button>
          <button
            type="button"
            onClick={openSettings}
            title="Insights settings"
            className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-surface-hover"
          >
            <Settings size={12} />
          </button>
        </div>
      </header>

      {lastRun && lastRun.errors.length === 0 && (
        <div className="text-[11px] text-text-muted">
          Found {lastRun.insights_generated} insight
          {lastRun.insights_generated === 1 ? '' : 's'} from{' '}
          {lastRun.detectors_run} detector{lastRun.detectors_run === 1 ? '' : 's'}.
        </div>
      )}
      {lastRun && lastRun.errors.length > 0 && (
        <div className="text-[11px] text-error">
          {lastRun.errors.length} detector{lastRun.errors.length === 1 ? '' : 's'} failed.
          See logs.
        </div>
      )}

      {insights.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6 text-text-muted">
          <Sparkles size={20} className="text-accent-muted/80" />
          <p className="text-xs text-center">
            {lastError ? lastError : 'Nothing to surface yet.'}
          </p>
          {!lastError && (
            <p className="text-[10px] text-center text-text-muted/80 max-w-[180px]">
              Phase 1 ships the engine without detectors. Cards will appear in
              Phase 2.
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {groups.map(([kind, items]) => (
            <section key={kind} className="space-y-1.5">
              <h4 className="text-[10px] uppercase tracking-wider text-text-muted">
                {kind.replace(/_/g, ' ')} ({items.length})
              </h4>
              <div className="space-y-1.5">
                {items.map((ins) => (
                  <InsightCard key={ins.id} insight={ins} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
