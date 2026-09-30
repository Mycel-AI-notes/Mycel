import { AlertTriangle, Check, Info, X } from 'lucide-react';
import { clsx } from 'clsx';
import { useToastStore, type ToastKind } from '@/stores/toast';

const ICONS: Record<ToastKind, typeof Info> = {
  error: AlertTriangle,
  info: Info,
  success: Check,
};

const ACCENT: Record<ToastKind, string> = {
  error: 'border-l-[color:var(--color-error)] text-text-primary',
  info: 'border-l-[color:var(--color-info)] text-text-primary',
  success: 'border-l-[color:var(--color-accent)] text-text-primary',
};

const ICON_COLOR: Record<ToastKind, string> = {
  error: 'text-[color:var(--color-error)]',
  info: 'text-[color:var(--color-info)]',
  success: 'text-accent',
};

/**
 * Bottom-right stack of transient messages. Self-renders from the store, so it
 * mounts once in App and needs no props.
 *
 * `aria-live="polite"` rather than `assertive`: these announce after the user's
 * own action, and interrupting a screen reader mid-word to say "saved" is
 * worse than waiting for a pause.
 */
export function Toasts() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed bottom-8 right-4 z-[60] flex flex-col gap-2 w-[min(24rem,calc(100vw-2rem))]"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => {
        const Icon = ICONS[t.kind];
        return (
          <div
            key={t.id}
            className={clsx(
              'flex items-start gap-2 rounded-md border border-border border-l-2 bg-surface-2 px-3 py-2 text-xs shadow-lg',
              ACCENT[t.kind],
            )}
          >
            <Icon size={14} className={clsx('mt-0.5 shrink-0', ICON_COLOR[t.kind])} />
            <span className="flex-1 break-words leading-relaxed">{t.message}</span>
            <button
              onClick={() => dismiss(t.id)}
              className="shrink-0 rounded p-0.5 text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary"
              title="Dismiss"
              aria-label="Dismiss"
            >
              <X size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
