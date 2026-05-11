import { X } from 'lucide-react';
import { useUIStore } from '@/stores/ui';
import type { FeatureFlags } from '@/stores/ui';

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

export function SettingsDialog() {
  const open = useUIStore((s) => s.settingsOpen);
  const close = useUIStore((s) => s.closeSettings);
  const features = useUIStore((s) => s.features);
  const setFeature = useUIStore((s) => s.setFeature);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
      onClick={close}
    >
      <div
        className="w-full max-w-md mx-4 bg-surface-1 border border-border rounded-lg shadow-2xl overflow-hidden"
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

        <div className="p-5">
          <h3 className="text-xs uppercase tracking-wider text-text-muted mb-2">
            Features
          </h3>
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
        </div>

        <footer className="px-5 py-2 border-t border-border bg-surface-0 text-[11px] text-text-muted">
          Changes apply immediately.
        </footer>
      </div>
    </div>
  );
}
