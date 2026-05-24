import { clsx } from 'clsx';
import { X, AlertCircle, Info } from 'lucide-react';
import { useToastStore } from '@/stores/toast';

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  const dismiss = useToastStore((s) => s.dismiss);

  if (toasts.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[100] flex flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="status"
          className={clsx(
            'pointer-events-auto flex items-start gap-2 rounded-md border px-3 py-2 text-sm shadow-lg max-w-sm',
            'bg-surface-0 text-text-primary',
            t.kind === 'error' ? 'border-error/50' : 'border-border',
          )}
        >
          {t.kind === 'error' ? (
            <AlertCircle size={15} className="mt-0.5 shrink-0 text-error" />
          ) : (
            <Info size={15} className="mt-0.5 shrink-0 text-accent" />
          )}
          <span className="flex-1 leading-snug">{t.message}</span>
          <button
            onClick={() => dismiss(t.id)}
            className="shrink-0 rounded p-0.5 text-text-muted hover:bg-surface-hover hover:text-text-primary"
            title="Dismiss"
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
