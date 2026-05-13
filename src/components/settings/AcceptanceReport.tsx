import { useEffect, useState } from 'react';
import { useInsightsStore, type TelemetryReport } from '@/stores/insights';

const RANGES: { label: string; days: number }[] = [
  { label: 'Last 7 days',  days: 7 },
  { label: 'Last 30 days', days: 30 },
  { label: 'Last 90 days', days: 90 },
];

/// Local-only analytics table. Renders the (detector, shown, acted, dismissed,
/// rate) grid used to spot detectors that the user routinely ignores.
///
/// Rate = acted / shown, displayed as a percentage. Below 30% for two weeks
/// straight is the trigger to consider muting the detector.
export function AcceptanceReport() {
  const getReport = useInsightsStore((s) => s.getReport);
  const [range, setRange] = useState(30);
  const [report, setReport] = useState<TelemetryReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setErr(null);
    getReport(range)
      .then((r) => {
        if (!cancelled) setReport(r);
      })
      .catch((e) => {
        if (!cancelled) setErr(String(e));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [range, getReport]);

  const totals = report?.rows.reduce(
    (acc, r) => {
      acc.shown += r.shown;
      acc.acted += r.acted;
      acc.dismissed += r.dismissed;
      return acc;
    },
    { shown: 0, acted: 0, dismissed: 0 },
  );

  return (
    <div className="rounded-md border border-border bg-surface-0 p-3 mt-1 space-y-2">
      <div className="flex items-center justify-between">
        <h4 className="text-xs uppercase tracking-wider text-text-muted">
          Acceptance report
        </h4>
        <select
          value={range}
          onChange={(e) => setRange(parseInt(e.target.value, 10))}
          className="text-[11px] px-1.5 py-0.5 rounded border border-border bg-surface-1 text-text-primary"
        >
          {RANGES.map((r) => (
            <option key={r.days} value={r.days}>
              {r.label}
            </option>
          ))}
        </select>
      </div>

      {err && <div className="text-[11px] text-error">{err}</div>}
      {loading && !report && (
        <div className="text-[11px] text-text-muted">Loading…</div>
      )}

      {report && (
        <table className="w-full text-[11px] tabular-nums">
          <thead className="text-text-muted">
            <tr className="border-b border-border">
              <th className="text-left py-1 font-normal">Detector</th>
              <th className="text-right py-1 font-normal">Shown</th>
              <th className="text-right py-1 font-normal">Acted</th>
              <th className="text-right py-1 font-normal">Dismissed</th>
              <th className="text-right py-1 font-normal">Rate</th>
            </tr>
          </thead>
          <tbody className="text-text-secondary">
            {report.rows.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-2 text-text-muted text-center">
                  No data yet — detectors land in Phase 2.
                </td>
              </tr>
            ) : (
              report.rows.map((r) => (
                <tr key={r.detector_name} className="border-b border-border/50">
                  <td className="py-1">{r.detector_name}</td>
                  <td className="py-1 text-right">{r.shown}</td>
                  <td className="py-1 text-right">{r.acted}</td>
                  <td className="py-1 text-right">{r.dismissed}</td>
                  <td className="py-1 text-right">
                    {r.shown > 0 ? `${Math.round((r.acted / r.shown) * 100)}%` : '—'}
                  </td>
                </tr>
              ))
            )}
            {totals && report.rows.length > 0 && (
              <tr className="text-text-primary">
                <td className="py-1 font-medium">Overall</td>
                <td className="py-1 text-right">{totals.shown}</td>
                <td className="py-1 text-right">{totals.acted}</td>
                <td className="py-1 text-right">{totals.dismissed}</td>
                <td className="py-1 text-right">
                  {totals.shown > 0
                    ? `${Math.round((totals.acted / totals.shown) * 100)}%`
                    : '—'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      <p className="text-[10px] text-text-muted">
        Stored locally in <code>.mycel/ai/index.db</code>. Never leaves your
        machine.
      </p>
    </div>
  );
}
