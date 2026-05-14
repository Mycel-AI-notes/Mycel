import { useEffect, useMemo } from 'react';
import { Loader2, Play, Settings, Sparkles } from 'lucide-react';
import { clsx } from 'clsx';
import { useInsightsStore, type Insight, type InsightKind } from '@/stores/insights';
import { useUIStore } from '@/stores/ui';
import { InsightCard } from './InsightCard';

/// Full-page Insights inbox, rendered in the main editor area when the
/// `insights:inbox` synthetic tab is active (mirrors how Garden views work).
///
/// Only reachable when the engine is enabled — the sidebar entry that opens
/// this tab is itself hidden when Insights is off, so this component never
/// renders for a disabled engine.
export function InsightsView() {
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
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto">
        <header className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h1 className="flex items-center gap-2 text-xl text-text-primary">
              <Sparkles size={20} className="text-accent" /> Insights
              <span className="text-text-muted text-sm">
                ({insights.length})
              </span>
            </h1>
            <div className="text-xs text-text-muted mt-1">
              {lastRunLabel ? `Last run · ${lastRunLabel}` : 'No runs yet today'}
              {' · '}
              Scheduled · {status?.settings.schedule.time ?? '07:00'}
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void runNow()}
              disabled={running}
              title="Run all detectors now"
              className={clsx(
                'inline-flex items-center gap-1.5 px-3 py-1.5 rounded text-sm',
                running
                  ? 'bg-surface-1 text-text-muted cursor-wait'
                  : 'bg-accent/15 text-accent hover:bg-accent/25',
              )}
            >
              {running ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Play size={14} />
              )}
              Run now
            </button>
            <button
              type="button"
              onClick={openSettings}
              title="Insights settings"
              className="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-surface-hover"
            >
              <Settings size={16} />
            </button>
          </div>
        </header>

        {lastRun && lastRun.errors.length === 0 && (
          <div className="text-xs text-text-muted mb-3">
            Found {lastRun.insights_generated} insight
            {lastRun.insights_generated === 1 ? '' : 's'} from{' '}
            {lastRun.detectors_run} detector
            {lastRun.detectors_run === 1 ? '' : 's'}.
          </div>
        )}
        {lastRun && lastRun.errors.length > 0 && (
          <div className="text-xs text-error mb-3">
            {lastRun.errors.length} detector
            {lastRun.errors.length === 1 ? '' : 's'} failed during the last run.
          </div>
        )}

        {insights.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-16 text-text-muted">
            <Sparkles size={28} className="text-accent-muted/80" />
            <p className="text-sm text-center">
              {lastError ? lastError : 'Nothing to surface right now.'}
            </p>
            {!lastError && (
              <p className="text-xs text-center text-text-muted/80 max-w-sm">
                The similar-notes detector needs an AI key and a built index.
                Set those up in Settings → AI, then hit Run now.
              </p>
            )}
          </div>
        ) : (
          <div className="flex flex-col gap-5">
            {groups.map(([kind, items]) => (
              <section key={kind} className="flex flex-col gap-2">
                <h2 className="text-[11px] uppercase tracking-wider text-text-muted">
                  {kind.replace(/_/g, ' ')} ({items.length})
                </h2>
                <div className="flex flex-col gap-2">
                  {items.map((ins) => (
                    <InsightCard key={ins.id} insight={ins} />
                  ))}
                </div>
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
