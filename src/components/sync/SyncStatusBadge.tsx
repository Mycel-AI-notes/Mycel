import { AlertTriangle, GitBranch, Loader2 } from 'lucide-react';
import { clsx } from 'clsx';
import { useSyncStore } from '@/stores/sync';

interface Props {
  onClick: () => void;
  className?: string;
}

/**
 * Tiny sidebar button: opens the SyncPanel and shows live sync state.
 *  - Spinner when syncing
 *  - Red exclamation when conflicts or error
 *  - Accent dot when there are local/remote changes pending
 *  - Muted icon when up to date or sync not configured
 */
export function SyncStatusBadge({ onClick, className }: Props) {
  const status = useSyncStore((s) => s.status);
  const isSyncing = useSyncStore((s) => s.isSyncing);
  const lastError = useSyncStore((s) => s.lastError);

  const configured = !!status?.configured;
  const conflicts = (status?.conflicts?.length ?? 0) > 0;
  const pending = (status?.ahead ?? 0) + (status?.behind ?? 0) > 0 || (status?.dirty ?? false);

  let tooltip = 'GitHub sync — not configured';
  if (configured) {
    if (isSyncing) tooltip = 'Syncing…';
    else if (conflicts) tooltip = `Conflicts in ${status?.conflicts.length} file(s)`;
    else if (lastError) tooltip = `Sync error: ${lastError}`;
    else if (pending)
      tooltip = `${status?.ahead ?? 0} ahead, ${status?.behind ?? 0} behind${status?.dirty ? ', local changes' : ''}`;
    else tooltip = 'Up to date';
  }

  return (
    <button
      onClick={onClick}
      title={tooltip}
      aria-label={tooltip}
      className={clsx(
        'relative inline-flex items-center justify-center p-1.5 rounded hover:bg-surface-hover transition-colors',
        conflicts || lastError ? 'text-error' : 'text-text-muted hover:text-text-primary',
        className,
      )}
    >
      {isSyncing ? (
        <Loader2 size={14} className="animate-spin" />
      ) : conflicts || lastError ? (
        <AlertTriangle size={14} />
      ) : (
        <GitBranch size={14} />
      )}
      {configured && !isSyncing && !conflicts && !lastError && pending && (
        <span className="absolute top-1 right-1 h-1.5 w-1.5 rounded-full bg-accent" />
      )}
    </button>
  );
}
