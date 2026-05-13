import { useState } from 'react';
import { Sparkles, SlidersHorizontal, X } from 'lucide-react';
import { useUIStore } from '@/stores/ui';
import type { FeatureFlags } from '@/stores/ui';
import { AISettings } from '@/components/settings/AISettings';

interface FeatureRow {
  key: keyof FeatureFlags;
  label: string;
  description: string;
}

const FEATURE_ROWS: FeatureRow[] = [
  {
    key: 'garden',
    label: 'Garden (GTD)',
    description:
      'Show the Garden section in the sidebar and enable Inbox, Next Actions, Projects, Waiting For, and Someday.',
  },
];

type Tab = 'features' | 'ai';

const TABS: { id: Tab; label: string; icon: typeof Sparkles }[] = [
  { id: 'features', label: 'Features', icon: SlidersHorizontal },
  { id: 'ai', label: 'AI', icon: Sparkles },
];

export function SettingsDialog() {
  const open = useUIStore((s) => s.settingsOpen);
  const close = useUIStore((s) => s.closeSettings);
  const features = useUIStore((s) => s.features);
  const setFeature = useUIStore((s) => s.setFeature);

  // Per-open tab selection. We deliberately do NOT persist this — opening
  // Settings should put the user back on Features (the canonical first
  // section) rather than wherever they were last, which can be jarring.
  const [tab, setTab] = useState<Tab>('features');

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
      onClick={close}
    >
      <div
        // Fixed size, not content-driven. Switching tabs (Features → AI →
        // back) used to make the dialog jump because each tab's height
        // differed; pinning width and height keeps the chrome anchored and
        // lets the right pane scroll inside. `max-*` clamps cover tiny
        // viewports so the dialog still fits on small windows.
        className="w-[42rem] max-w-[calc(100vw-2rem)] h-[34rem] max-h-[calc(100vh-2rem)] bg-surface-1 border border-border rounded-lg shadow-2xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-3 border-b border-border bg-surface-0">
          <h2 className="text-text-primary text-sm font-semibold">Settings</h2>
          <button
            onClick={close}
            className="p-1 rounded text-text-muted hover:bg-surface-hover hover:text-text-primary"
            title="Close (Esc)"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex flex-1 min-h-0">
          <nav
            className="w-44 shrink-0 border-r border-border bg-surface-0/50 py-3"
            aria-label="Settings sections"
          >
            <ul className="flex flex-col gap-0.5 px-2">
              {TABS.map(({ id, label, icon: Icon }) => {
                const active = tab === id;
                return (
                  <li key={id}>
                    <button
                      type="button"
                      onClick={() => setTab(id)}
                      className={
                        'w-full flex items-center gap-2 px-2.5 py-1.5 rounded-md text-sm transition-colors ' +
                        (active
                          ? 'bg-surface-hover text-text-primary'
                          : 'text-text-secondary hover:bg-surface-hover hover:text-text-primary')
                      }
                      aria-current={active ? 'page' : undefined}
                    >
                      <Icon size={14} className={active ? 'text-accent' : ''} />
                      <span>{label}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </nav>

          <div className="flex-1 p-5 overflow-y-auto min-w-0">
            {tab === 'features' && (
              <ul className="flex flex-col gap-3">
                {FEATURE_ROWS.map((row) => (
                  <li key={row.key} className="flex items-start gap-3">
                    <input
                      id={`feat-${row.key}`}
                      type="checkbox"
                      checked={features[row.key]}
                      onChange={(e) => setFeature(row.key, e.target.checked)}
                      className="mt-1"
                    />
                    <label htmlFor={`feat-${row.key}`} className="flex-1 cursor-pointer">
                      <div className="text-sm text-text-primary">{row.label}</div>
                      <div className="text-xs text-text-muted mt-0.5">{row.description}</div>
                    </label>
                  </li>
                ))}
              </ul>
            )}

            {tab === 'ai' && <AISettings />}
          </div>
        </div>

        <footer className="px-5 py-2 border-t border-border bg-surface-0 text-[11px] text-text-muted">
          Changes apply immediately.
        </footer>
      </div>
    </div>
  );
}
