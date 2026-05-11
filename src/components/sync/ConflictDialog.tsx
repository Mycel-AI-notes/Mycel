import { useMemo, useState } from 'react';
import { AlertTriangle, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useVaultStore } from '@/stores/vault';
import { displayName } from '@/lib/note-name';
import { clsx } from 'clsx';

/** Modal shown when `note_save_checked` reported that the on-disk file
 *  changed under us (typically because sync pulled a remote edit while
 *  the user was typing). Lets the user pick how to reconcile. */
export function ConflictDialog() {
  const conflict = useVaultStore((s) => s.pendingConflict);
  const reload = useVaultStore((s) => s.resolveConflictReload);
  const keepMine = useVaultStore((s) => s.resolveConflictKeepMine);
  const keepBoth = useVaultStore((s) => s.resolveConflictKeepBoth);
  const dismiss = useVaultStore((s) => s.dismissConflict);

  const [view, setView] = useState<'choices' | 'diff'>('choices');
  const [busy, setBusy] = useState<null | 'reload' | 'mine' | 'both'>(null);

  if (!conflict) return null;

  const runAction = async (
    key: 'reload' | 'mine' | 'both',
    fn: () => Promise<void>,
  ) => {
    setBusy(key);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-0/70 backdrop-blur-sm">
      <div
        className={clsx(
          'relative w-full overflow-y-auto rounded-xl border border-border bg-surface-1 shadow-xl',
          view === 'diff' ? 'max-w-5xl max-h-[90vh]' : 'max-w-lg max-h-[90vh]',
        )}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <AlertTriangle size={16} className="text-warning" />
            <h2 className="text-sm font-semibold text-text-primary">
              File changed during sync
            </h2>
          </div>
          <button
            onClick={dismiss}
            disabled={busy !== null}
            className="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary disabled:opacity-50"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </header>

        <div className="p-5 space-y-4">
          <p className="text-xs text-text-secondary leading-relaxed">
            <strong className="text-text-primary">
              {displayName(conflict.path)}
            </strong>{' '}
            was modified on disk (by another device or the last pull) while
            you were editing. Your unsaved changes were not written. Pick how
            to reconcile.
          </p>

          {view === 'diff' ? (
            <DiffView
              local={conflict.localContent}
              disk={conflict.diskContent}
            />
          ) : (
            <div className="rounded-md border border-border bg-surface-0 px-3 py-2 text-[11px] font-mono text-text-muted truncate">
              {conflict.path}
            </div>
          )}

          <div className="grid grid-cols-2 gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => void runAction('reload', reload)}
              disabled={busy !== null}
            >
              {busy === 'reload' ? 'Loading…' : 'Reload from disk'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void runAction('mine', keepMine)}
              disabled={busy !== null}
            >
              {busy === 'mine' ? 'Saving…' : 'Keep mine'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void runAction('both', keepBoth)}
              disabled={busy !== null}
            >
              {busy === 'both' ? 'Saving…' : 'Keep all (with markers)'}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setView(view === 'diff' ? 'choices' : 'diff')}
              disabled={busy !== null}
            >
              {view === 'diff' ? 'Hide diff' : 'View diff'}
            </Button>
          </div>

          <ul className="space-y-1 text-[11px] text-text-muted leading-relaxed">
            <li>
              <strong>Reload from disk</strong> — discard your edits, load the
              remote version. Safe if you have not typed anything important.
            </li>
            <li>
              <strong>Keep mine</strong> — overwrite the disk version. The
              next sync will push your version (remote edits are lost unless
              they are also captured in your text).
            </li>
            <li>
              <strong>Keep all</strong> — write both versions into the file
              wrapped in <code>{'<<<<<<<'}</code> / <code>{'======='}</code> /
              <code>{' >>>>>>>'}</code> markers so you can manually merge.
              The tab stays dirty until you clean it up and save again.
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}

function DiffView({ local, disk }: { local: string; disk: string }) {
  const rows = useMemo(() => buildLineDiff(local, disk), [local, disk]);
  return (
    <div className="rounded-md border border-border overflow-hidden">
      <div className="grid grid-cols-2 text-[10px] uppercase tracking-wider bg-surface-0 text-text-muted border-b border-border">
        <div className="px-3 py-1.5 border-r border-border">Yours (in editor)</div>
        <div className="px-3 py-1.5">On disk (remote)</div>
      </div>
      <div className="max-h-[50vh] overflow-auto font-mono text-[11px]">
        {rows.map((row, i) => (
          <div key={i} className="grid grid-cols-2 border-b border-border/30">
            <DiffCell line={row.local} kind={row.kind === 'same' ? 'same' : 'local'} />
            <DiffCell line={row.disk} kind={row.kind === 'same' ? 'same' : 'disk'} />
          </div>
        ))}
      </div>
    </div>
  );
}

function DiffCell({
  line,
  kind,
}: {
  line: string | null;
  kind: 'same' | 'local' | 'disk';
}) {
  const bg =
    kind === 'same'
      ? ''
      : kind === 'local'
        ? 'bg-error/10'
        : 'bg-accent/10';
  return (
    <div
      className={clsx(
        'px-3 py-0.5 border-r border-border/30 whitespace-pre-wrap break-words',
        bg,
      )}
    >
      {line === null ? <span className="text-text-muted/50">·</span> : line || ' '}
    </div>
  );
}

interface DiffRow {
  kind: 'same' | 'diff';
  local: string | null;
  disk: string | null;
}

/** Side-by-side line diff using a Myers-style LCS table. Linear in the
 *  product of the two file lengths — fine for note-sized files. */
function buildLineDiff(a: string, b: string): DiffRow[] {
  const la = a.split('\n');
  const lb = b.split('\n');
  const n = la.length;
  const m = lb.length;

  // Build LCS table.
  const lcs: number[][] = Array.from({ length: n + 1 }, () =>
    new Array(m + 1).fill(0),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      lcs[i][j] =
        la[i] === lb[j]
          ? lcs[i + 1][j + 1] + 1
          : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }

  // Walk the table to produce paired rows.
  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (la[i] === lb[j]) {
      rows.push({ kind: 'same', local: la[i], disk: lb[j] });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      rows.push({ kind: 'diff', local: la[i], disk: null });
      i++;
    } else {
      rows.push({ kind: 'diff', local: null, disk: lb[j] });
      j++;
    }
  }
  while (i < n) {
    rows.push({ kind: 'diff', local: la[i], disk: null });
    i++;
  }
  while (j < m) {
    rows.push({ kind: 'diff', local: null, disk: lb[j] });
    j++;
  }
  return rows;
}
