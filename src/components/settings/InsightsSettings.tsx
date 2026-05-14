import { useEffect, useState } from 'react';
import { BarChart2 } from 'lucide-react';
import { useInsightsStore, type InsightsSettings } from '@/stores/insights';
import { AcceptanceReport } from './AcceptanceReport';

/// Settings card for the Insights engine. Lives below the AI key/budget card
/// inside SettingsDialog.
///
/// Phase 1 surfaces:
///   - master toggle
///   - daily schedule (HH:MM + catch-up)
///   - per-day / per-kind / cooldown limits
///   - acceptance report link
///
/// `detectors` is an empty dict in Phase 1 — when Phase 2 ships the first
/// real detector, this card auto-renders a toggle for it from the dict that
/// comes back from `insights_settings_get`.
export function InsightsSettings() {
  const status = useInsightsStore((s) => s.status);
  const update = useInsightsStore((s) => s.updateSettings);
  const load = useInsightsStore((s) => s.loadStatus);
  const lastError = useInsightsStore((s) => s.lastError);

  const [draft, setDraft] = useState<InsightsSettings | null>(null);
  const [showReport, setShowReport] = useState(false);

  useEffect(() => {
    void load();
  }, [load]);

  // Sync the editable draft from the source of truth whenever the backend
  // sends a fresh status. Reset only when we don't have local edits, so a
  // background reload (e.g. after Run now) doesn't clobber unsaved changes.
  useEffect(() => {
    if (status && !draft) {
      setDraft(status.settings);
    }
  }, [status, draft]);

  if (!status || !draft) {
    return (
      <div className="text-xs text-text-muted">
        Open a vault to configure Insights.
      </div>
    );
  }

  const patch = (mut: (s: InsightsSettings) => void) => {
    const next = structuredClone(draft);
    mut(next);
    setDraft(next);
    void update(next);
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-start gap-3">
        <input
          id="insights-enabled"
          type="checkbox"
          checked={draft.enabled}
          onChange={(e) => patch((s) => (s.enabled = e.target.checked))}
          className="mt-1"
        />
        <label htmlFor="insights-enabled" className="flex-1 cursor-pointer">
          <div className="text-sm text-text-primary">Enable Insights</div>
          <div className="text-xs text-text-muted mt-0.5">
            Runs once a day and surfaces what looks worth your attention.
            Off by default. No writes to your notes.
          </div>
        </label>
      </div>

      <fieldset className="flex flex-col gap-2" disabled={!draft.enabled}>
        <legend className="text-xs uppercase tracking-wider text-text-muted mb-1">
          Schedule
        </legend>
        <div className="flex items-center gap-2 text-xs text-text-secondary">
          <span>Run daily at</span>
          <input
            type="time"
            value={draft.schedule.time}
            onChange={(e) => patch((s) => (s.schedule.time = e.target.value))}
            className="px-2 py-1 rounded-md border border-border bg-surface-0 text-sm text-text-primary focus:outline-none focus:border-accent"
          />
        </div>
        <label className="flex items-start gap-2 text-xs text-text-secondary cursor-pointer">
          <input
            type="checkbox"
            checked={draft.schedule.catch_up}
            onChange={(e) => patch((s) => (s.schedule.catch_up = e.target.checked))}
            className="mt-0.5"
          />
          <span>
            Catch up if Mycel was closed at the scheduled time.
          </span>
        </label>
      </fieldset>

      <fieldset className="flex flex-col gap-2" disabled={!draft.enabled}>
        <legend className="text-xs uppercase tracking-wider text-text-muted mb-1">
          Limits
        </legend>
        <NumberRow
          label="Max cards per day"
          value={draft.limits.max_per_day}
          min={1}
          max={100}
          onChange={(v) => patch((s) => (s.limits.max_per_day = v))}
        />
        <NumberRow
          label="Max cards per type"
          value={draft.limits.max_per_kind}
          min={1}
          max={20}
          onChange={(v) => patch((s) => (s.limits.max_per_kind = v))}
        />
        <NumberRow
          label="Cooldown after dismiss (days)"
          value={draft.limits.default_cooldown_days}
          min={0}
          max={365}
          onChange={(v) => patch((s) => (s.limits.default_cooldown_days = v))}
        />
      </fieldset>

      <fieldset className="flex flex-col gap-2" disabled={!draft.enabled}>
        <legend className="text-xs uppercase tracking-wider text-text-muted mb-1">
          Similar notes
        </legend>
        <PercentRow
          label="Minimum similarity"
          hint="Higher = stricter, fewer “these two notes are related” cards."
          value={draft.similar_notes_min_similarity}
          onChange={(v) => patch((s) => (s.similar_notes_min_similarity = v))}
        />
        <PercentRow
          label="Duplicate threshold"
          hint="At or above this, a pair is treated as a duplicate — the card offers “Resolve duplicate” instead of “Insert link”."
          value={draft.similar_notes_duplicate_similarity}
          onChange={(v) =>
            patch((s) => (s.similar_notes_duplicate_similarity = v))
          }
        />
        <NumberRow
          label="Minimum note length (words)"
          value={draft.similar_notes_min_words}
          min={0}
          max={1000}
          onChange={(v) => patch((s) => (s.similar_notes_min_words = v))}
        />
        <p className="text-[11px] text-text-muted">
          Notes shorter than this are ignored — short stubs produce noisy
          matches.
        </p>
      </fieldset>

      <fieldset className="flex flex-col gap-2" disabled={!draft.enabled}>
        <legend className="text-xs uppercase tracking-wider text-text-muted mb-1">
          Detectors
        </legend>
        {Object.keys(draft.detectors).length === 0 ? (
          <div className="text-[11px] text-text-muted">
            Detectors run automatically. Toggles appear here once you mute one.
          </div>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {Object.entries(draft.detectors).map(([name, on]) => (
              <li key={name} className="flex items-center gap-2 text-xs">
                <input
                  id={`det-${name}`}
                  type="checkbox"
                  checked={on}
                  onChange={(e) =>
                    patch((s) => {
                      s.detectors[name] = e.target.checked;
                    })
                  }
                />
                <label htmlFor={`det-${name}`} className="text-text-secondary">
                  {name}
                </label>
              </li>
            ))}
          </ul>
        )}
      </fieldset>

      <div className="flex flex-col gap-1">
        <button
          type="button"
          onClick={() => setShowReport((v) => !v)}
          className="inline-flex items-center gap-1.5 self-start text-xs text-accent hover:underline"
        >
          <BarChart2 size={12} />
          {showReport ? 'Hide' : 'View'} acceptance report
        </button>
        {showReport && <AcceptanceReport />}
      </div>

      {lastError && (
        <div className="text-[11px] text-error">{lastError}</div>
      )}
    </div>
  );
}

interface NumberRowProps {
  label: string;
  value: number;
  min: number;
  max: number;
  onChange: (v: number) => void;
}

function NumberRow({ label, value, min, max, onChange }: NumberRowProps) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs text-text-secondary">
      <span>{label}</span>
      <input
        type="number"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = parseInt(e.target.value, 10);
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
        }}
        className="w-20 px-2 py-1 rounded-md border border-border bg-surface-0 text-sm text-text-primary focus:outline-none focus:border-accent"
      />
    </label>
  );
}

interface PercentRowProps {
  label: string;
  hint: string;
  value: number;
  onChange: (v: number) => void;
}

function PercentRow({ label, hint, value, onChange }: PercentRowProps) {
  return (
    <label className="flex items-center justify-between gap-3 text-xs text-text-secondary">
      <span className="flex-1">
        {label}
        <span className="block text-[11px] text-text-muted">{hint}</span>
      </span>
      <span className="flex items-center gap-2 shrink-0">
        <input
          type="range"
          min={0}
          max={100}
          step={5}
          value={value}
          onChange={(e) => onChange(parseInt(e.target.value, 10))}
          className="w-28 accent-accent"
        />
        <span className="w-10 text-right tabular-nums text-text-primary">
          {value}%
        </span>
      </span>
    </label>
  );
}
