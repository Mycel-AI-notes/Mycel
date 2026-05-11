import { useEffect, useState } from 'react';
import { openUrl } from '@tauri-apps/plugin-opener';
import {
  AlertTriangle,
  Check,
  GitBranch,
  KeyRound,
  Loader2,
  LogOut,
  RefreshCw,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSyncStore } from '@/stores/sync';
import { clsx } from 'clsx';

interface Props {
  onClose: () => void;
}

const PAT_DOCS_URL =
  'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-fine-grained-personal-access-token';

export function SyncPanel({ onClose }: Props) {
  const config = useSyncStore((s) => s.config);
  const status = useSyncStore((s) => s.status);
  const isSyncing = useSyncStore((s) => s.isSyncing);
  const lastError = useSyncStore((s) => s.lastError);
  const lastOutcome = useSyncStore((s) => s.lastOutcome);
  const connect = useSyncStore((s) => s.connect);
  const syncNow = useSyncStore((s) => s.syncNow);
  const setAutoSync = useSyncStore((s) => s.setAutoSync);
  const setToken = useSyncStore((s) => s.setToken);
  const disconnect = useSyncStore((s) => s.disconnect);
  const loadForVault = useSyncStore((s) => s.loadForVault);

  useEffect(() => {
    void loadForVault();
  }, [loadForVault]);

  const isConfigured = !!status?.configured;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-0/70 backdrop-blur-sm">
      <div className="relative w-full max-w-lg max-h-[90vh] overflow-y-auto rounded-xl border border-border bg-surface-1 shadow-xl">
        <header className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <GitBranch size={16} className="text-accent" />
            <h2 className="text-sm font-semibold text-text-primary">
              GitHub sync
            </h2>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </header>

        <div className="p-5 space-y-4">
          {!isConfigured ? (
            <ConnectForm onSubmit={connect} isSyncing={isSyncing} />
          ) : (
            <ConnectedView
              remote={status?.remote ?? config?.remote ?? ''}
              branch={status?.branch ?? config?.branch ?? 'main'}
              ahead={status?.ahead ?? 0}
              behind={status?.behind ?? 0}
              dirty={status?.dirty ?? false}
              hasToken={status?.has_token ?? false}
              conflicts={status?.conflicts ?? []}
              autoSync={config?.auto_sync ?? true}
              lastSyncAt={config?.last_sync_at ?? null}
              isSyncing={isSyncing}
              lastOutcome={lastOutcome}
              onSyncNow={() => void syncNow()}
              onToggleAutoSync={(v) => void setAutoSync(v)}
              onChangeToken={(t) => setToken(t)}
              onDisconnect={() => void disconnect()}
            />
          )}

          {lastError && (
            <div className="flex items-start gap-2 rounded-md border border-error/40 bg-error/10 px-3 py-2 text-xs text-error">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" />
              <span className="break-words">{lastError}</span>
            </div>
          )}
        </div>

        <footer className="px-5 py-3 border-t border-border text-[11px] text-text-muted">
          Token saved in OS keychain. Vault is pushed to a{' '}
          <strong className="text-text-secondary">private</strong> GitHub repo —
          GitHub holds the data at rest.{' '}
          <button
            onClick={() => void openUrl(PAT_DOCS_URL)}
            className="text-accent hover:text-accent-bright underline"
          >
            How to create a fine-grained PAT
          </button>
        </footer>
      </div>
    </div>
  );
}

interface ConnectFormProps {
  isSyncing: boolean;
  onSubmit: (args: {
    remote: string;
    branch?: string;
    token: string;
  }) => Promise<void>;
}

function ConnectForm({ isSyncing, onSubmit }: ConnectFormProps) {
  const [remote, setRemote] = useState('');
  const [branch, setBranch] = useState('main');
  const [token, setToken] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const handle = async () => {
    setLocalError(null);
    if (!remote.trim() || !token.trim()) {
      setLocalError('Repository URL and token are required.');
      return;
    }
    try {
      await onSubmit({ remote: remote.trim(), branch: branch.trim() || 'main', token: token.trim() });
    } catch (e) {
      setLocalError(String(e));
    }
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-text-secondary leading-relaxed">
        Pick a <strong>private</strong> GitHub repo (empty or already containing
        a vault) and a fine-grained PAT with <code>Contents: Read & Write</code>{' '}
        permission on that repo.
      </p>

      <Field label="Repository URL" htmlFor="sync-remote">
        <input
          id="sync-remote"
          value={remote}
          onChange={(e) => setRemote(e.target.value)}
          placeholder="https://github.com/you/my-vault.git"
          className="w-full px-2.5 py-1.5 rounded-md border border-border bg-surface-0 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
        />
      </Field>

      <Field label="Branch" htmlFor="sync-branch">
        <input
          id="sync-branch"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
          placeholder="main"
          className="w-full px-2.5 py-1.5 rounded-md border border-border bg-surface-0 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent"
        />
      </Field>

      <Field label="Personal Access Token" htmlFor="sync-token">
        <input
          id="sync-token"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder="github_pat_…"
          className="w-full px-2.5 py-1.5 rounded-md border border-border bg-surface-0 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent font-mono"
        />
      </Field>

      {localError && (
        <div className="text-xs text-error">{localError}</div>
      )}

      <Button onClick={() => void handle()} disabled={isSyncing} className="w-full">
        {isSyncing ? (
          <>
            <Loader2 size={14} className="animate-spin mr-2" /> Connecting…
          </>
        ) : (
          <>Connect & sync</>
        )}
      </Button>
    </div>
  );
}

interface ConnectedProps {
  remote: string;
  branch: string;
  ahead: number;
  behind: number;
  dirty: boolean;
  hasToken: boolean;
  conflicts: string[];
  autoSync: boolean;
  lastSyncAt: string | null;
  isSyncing: boolean;
  lastOutcome: ReturnType<typeof useSyncStore.getState>['lastOutcome'];
  onSyncNow: () => void;
  onToggleAutoSync: (v: boolean) => void;
  onChangeToken: (t: string) => Promise<void>;
  onDisconnect: () => void;
}

function ConnectedView(props: ConnectedProps) {
  const [tokenInput, setTokenInput] = useState('');
  const [tokenSaving, setTokenSaving] = useState(false);
  const [showTokenField, setShowTokenField] = useState(!props.hasToken);

  const summary = props.conflicts.length
    ? `Conflicts in ${props.conflicts.length} file(s)`
    : props.dirty
      ? `${props.ahead} ahead · ${props.behind} behind · local changes`
      : props.ahead || props.behind
        ? `${props.ahead} ahead · ${props.behind} behind`
        : 'Up to date';

  return (
    <div className="space-y-3">
      <div className="rounded-md border border-border bg-surface-0 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <div className="text-[11px] text-text-muted">Remote</div>
            <div className="text-xs font-mono text-text-primary truncate" title={props.remote}>
              {props.remote}
            </div>
          </div>
          <div className="text-right">
            <div className="text-[11px] text-text-muted">Branch</div>
            <div className="text-xs font-mono text-text-primary">{props.branch}</div>
          </div>
        </div>
      </div>

      <div className={clsx(
        'flex items-center justify-between gap-2 rounded-md px-3 py-2 text-xs',
        props.conflicts.length
          ? 'border border-error/40 bg-error/10 text-error'
          : 'border border-border bg-surface-0 text-text-secondary',
      )}>
        <span className="flex items-center gap-2">
          {props.conflicts.length ? <AlertTriangle size={14} /> : <Check size={14} className="text-accent" />}
          {summary}
        </span>
        <Button
          variant="outline"
          size="sm"
          onClick={props.onSyncNow}
          disabled={props.isSyncing || !props.hasToken}
        >
          {props.isSyncing ? (
            <>
              <Loader2 size={12} className="animate-spin mr-1.5" /> Syncing…
            </>
          ) : (
            <>
              <RefreshCw size={12} className="mr-1.5" /> Sync now
            </>
          )}
        </Button>
      </div>

      {props.conflicts.length > 0 && (
        <div className="rounded-md border border-error/40 bg-error/5 px-3 py-2 text-xs text-text-secondary">
          <div className="mb-1 font-medium text-error">Resolve manually:</div>
          <ul className="space-y-0.5 font-mono">
            {props.conflicts.slice(0, 8).map((p) => (
              <li key={p} className="truncate" title={p}>· {p}</li>
            ))}
            {props.conflicts.length > 8 && (
              <li>… and {props.conflicts.length - 8} more</li>
            )}
          </ul>
          <p className="mt-2 text-[11px] text-text-muted leading-relaxed">
            Open each file, remove conflict markers (<code>{`<<<<<<<`}</code>, <code>{`=======`}</code>, <code>{`>>>>>>>`}</code>),
            then click Sync now.
          </p>
        </div>
      )}

      <label className="flex items-center justify-between gap-2 rounded-md border border-border bg-surface-0 px-3 py-2 text-xs text-text-secondary cursor-pointer">
        <span>Auto-sync after edits</span>
        <input
          type="checkbox"
          checked={props.autoSync}
          onChange={(e) => props.onToggleAutoSync(e.target.checked)}
          className="accent-accent"
        />
      </label>

      {props.lastSyncAt && (
        <div className="text-[11px] text-text-muted">
          Last sync: {new Date(props.lastSyncAt).toLocaleString()}
        </div>
      )}

      {showTokenField ? (
        <div className="space-y-2 rounded-md border border-border bg-surface-0 px-3 py-2">
          <div className="text-[11px] text-text-muted flex items-center gap-1.5">
            <KeyRound size={11} /> {props.hasToken ? 'Replace token' : 'Add token'}
          </div>
          <input
            type="password"
            value={tokenInput}
            onChange={(e) => setTokenInput(e.target.value)}
            placeholder="github_pat_…"
            className="w-full px-2 py-1 rounded border border-border bg-surface-1 text-xs font-mono text-text-primary focus:outline-none focus:border-accent"
          />
          <div className="flex gap-2">
            <Button
              size="sm"
              disabled={tokenSaving || !tokenInput.trim()}
              onClick={async () => {
                setTokenSaving(true);
                try {
                  await props.onChangeToken(tokenInput.trim());
                  setTokenInput('');
                  setShowTokenField(false);
                } finally {
                  setTokenSaving(false);
                }
              }}
            >
              Save token
            </Button>
            {props.hasToken && (
              <Button size="sm" variant="ghost" onClick={() => setShowTokenField(false)}>
                Cancel
              </Button>
            )}
          </div>
        </div>
      ) : (
        <Button variant="outline" size="sm" onClick={() => setShowTokenField(true)} className="w-full">
          <KeyRound size={12} className="mr-1.5" /> Change token
        </Button>
      )}

      <Button
        variant="outline"
        size="sm"
        onClick={props.onDisconnect}
        className="w-full text-error hover:text-error border-error/40 hover:border-error/60"
      >
        <LogOut size={12} className="mr-1.5" /> Disconnect (keep local files)
      </Button>
    </div>
  );
}

function Field({
  label,
  htmlFor,
  children,
}: {
  label: string;
  htmlFor: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="text-[11px] uppercase tracking-wider text-text-muted">
        {label}
      </label>
      {children}
    </div>
  );
}
