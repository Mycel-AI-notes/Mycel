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

/** How many unchanged lines to keep as context around each changed block
 *  before collapsing the rest into a "… N lines unchanged …" placeholder.
 *  Mirrors the default git uses for unified diffs. */
const CONTEXT_LINES = 3;

function DiffView({ local, disk }: { local: string; disk: string }) {
  const rows = useMemo(() => buildLineDiff(local, disk), [local, disk]);
  const blocks = useMemo(() => foldUnchanged(rows, CONTEXT_LINES), [rows]);

  if (rows.every((r) => r.kind === 'same')) {
    return (
      <div className="rounded-md border border-border bg-surface-0 px-3 py-2 text-xs text-text-muted">
        No textual differences — the files are identical line by line. The
        on-disk version may differ only in trailing whitespace or line
        endings.
      </div>
    );
  }

  return (
    <div className="rounded-md border border-border overflow-hidden">
      <div className="grid grid-cols-[3rem_1fr_3rem_1fr] text-[10px] uppercase tracking-wider bg-surface-0 text-text-muted border-b border-border">
        <div className="px-2 py-1.5 text-right border-r border-border">#</div>
        <div className="px-3 py-1.5 border-r border-border">Yours (editor)</div>
        <div className="px-2 py-1.5 text-right border-r border-border">#</div>
        <div className="px-3 py-1.5">On disk (remote)</div>
      </div>
      <div className="max-h-[50vh] overflow-auto font-mono text-[11px]">
        {blocks.map((block, bi) => {
          if (block.kind === 'gap') {
            return (
              <div
                key={`gap-${bi}`}
                className="grid grid-cols-[3rem_1fr_3rem_1fr] bg-surface-0/60 text-text-muted text-[10px] italic border-y border-border/40"
              >
                <div className="px-2 py-1 text-right border-r border-border/40">⋯</div>
                <div className="px-3 py-1 col-span-3">
                  {block.count} unchanged line{block.count === 1 ? '' : 's'}
                </div>
              </div>
            );
          }
          return (
            <div
              key={`row-${bi}`}
              className="grid grid-cols-[3rem_1fr_3rem_1fr] border-b border-border/30"
            >
              <LineNumber n={block.row.localLine} kind={block.row.kind} side="local" />
              <DiffCell line={block.row.local} kind={block.row.kind} side="local" />
              <LineNumber n={block.row.diskLine} kind={block.row.kind} side="disk" />
              <DiffCell line={block.row.disk} kind={block.row.kind} side="disk" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

function LineNumber({
  n,
  kind,
  side,
}: {
  n: number | null;
  kind: 'same' | 'diff';
  side: 'local' | 'disk';
}) {
  const bg = kind === 'same' ? '' : side === 'local' ? 'bg-error/10' : 'bg-accent/10';
  return (
    <div
      className={clsx(
        'px-2 py-0.5 text-right text-text-muted border-r border-border/30 select-none',
        bg,
      )}
    >
      {n === null ? '' : n}
    </div>
  );
}

function DiffCell({
  line,
  kind,
  side,
}: {
  line: string | null;
  kind: 'same' | 'diff';
  side: 'local' | 'disk';
}) {
  const isMissing = line === null;
  const bg =
    kind === 'same' ? '' : side === 'local' ? 'bg-error/10' : 'bg-accent/10';
  const marker = kind === 'same' ? ' ' : side === 'local' ? '−' : '+';
  return (
    <div
      className={clsx(
        'px-3 py-0.5 border-r border-border/30 whitespace-pre-wrap break-words',
        bg,
      )}
    >
      {isMissing ? (
        <span className="text-text-muted/40">·</span>
      ) : (
        <>
          <span className="text-text-muted/60 select-none mr-1">{marker}</span>
          {line || ' '}
        </>
      )}
    </div>
  );
}

interface DiffRow {
  kind: 'same' | 'diff';
  local: string | null;
  disk: string | null;
  /** 1-based line number in the local doc, or null for added-on-remote rows. */
  localLine: number | null;
  /** 1-based line number in the disk doc, or null for added-on-local rows. */
  diskLine: number | null;
}

type DiffBlock =
  | { kind: 'row'; row: DiffRow }
  | { kind: 'gap'; count: number };

/** Replace runs of >2*CONTEXT same rows with a "N unchanged" gap placeholder,
 *  keeping `context` lines on each side of every changed block. */
function foldUnchanged(rows: DiffRow[], context: number): DiffBlock[] {
  // Mark which rows must remain visible: any diff row, and `context` rows on
  // either side of one.
  const keep = new Array(rows.length).fill(false);
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].kind !== 'diff') continue;
    for (let k = Math.max(0, i - context); k <= Math.min(rows.length - 1, i + context); k++) {
      keep[k] = true;
    }
  }

  const out: DiffBlock[] = [];
  let i = 0;
  while (i < rows.length) {
    if (keep[i]) {
      out.push({ kind: 'row', row: rows[i] });
      i++;
    } else {
      let j = i;
      while (j < rows.length && !keep[j]) j++;
      out.push({ kind: 'gap', count: j - i });
      i = j;
    }
  }
  return out;
}

/** Side-by-side line diff using an LCS table. Linear in the product of
 *  the two file lengths — fine for note-sized files. */
function buildLineDiff(a: string, b: string): DiffRow[] {
  const la = a.split('\n');
  const lb = b.split('\n');
  const n = la.length;
  const m = lb.length;

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

  const rows: DiffRow[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (la[i] === lb[j]) {
      rows.push({
        kind: 'same',
        local: la[i],
        disk: lb[j],
        localLine: i + 1,
        diskLine: j + 1,
      });
      i++;
      j++;
    } else if (lcs[i + 1][j] >= lcs[i][j + 1]) {
      rows.push({
        kind: 'diff',
        local: la[i],
        disk: null,
        localLine: i + 1,
        diskLine: null,
      });
      i++;
    } else {
      rows.push({
        kind: 'diff',
        local: null,
        disk: lb[j],
        localLine: null,
        diskLine: j + 1,
      });
      j++;
    }
  }
  while (i < n) {
    rows.push({
      kind: 'diff',
      local: la[i],
      disk: null,
      localLine: i + 1,
      diskLine: null,
    });
    i++;
  }
  while (j < m) {
    rows.push({
      kind: 'diff',
      local: null,
      disk: lb[j],
      localLine: null,
      diskLine: j + 1,
    });
    j++;
  }
  return rows;
}
