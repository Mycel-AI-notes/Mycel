import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { openUrl } from '@tauri-apps/plugin-opener';
import { FolderOpen, Loader2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useVaultStore } from '@/stores/vault';

interface Props {
  onClose: () => void;
}

const PAT_DOCS_URL =
  'https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens#creating-a-fine-grained-personal-access-token';

export function CloneVaultDialog({ onClose }: Props) {
  const [remote, setRemote] = useState('');
  const [branch, setBranch] = useState('main');
  const [token, setToken] = useState('');
  const [dest, setDest] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const openVault = useVaultStore((s) => s.openVault);

  const pickDest = async () => {
    try {
      const selected = await openDialog({ directory: true, multiple: false });
      if (selected) setDest(selected as string);
    } catch (e) {
      setError(String(e));
    }
  };

  const submit = async () => {
    setError(null);
    if (!remote.trim() || !token.trim() || !dest.trim()) {
      setError('Repository URL, token, and destination folder are required.');
      return;
    }
    setBusy(true);
    try {
      const finalDest = await invoke<string>('sync_clone', {
        args: {
          remote: remote.trim(),
          dest: dest.trim(),
          branch: branch.trim() || 'main',
          token: token.trim(),
        },
      });
      await openVault(finalDest);
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-surface-0/70 backdrop-blur-sm">
      <div className="relative w-full max-w-md rounded-xl border border-border bg-surface-1 shadow-xl">
        <header className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-sm font-semibold text-text-primary">Clone vault from GitHub</h2>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary"
            aria-label="Close"
          >
            <X size={14} />
          </button>
        </header>

        <div className="p-5 space-y-3">
          <p className="text-xs text-text-secondary leading-relaxed">
            Clones a GitHub repo into a local folder and opens it as a vault.
            Use this on a second device to pick up a vault you already pushed
            from your first device.
          </p>

          <div className="space-y-1">
            <label className="text-[11px] uppercase tracking-wider text-text-muted">
              Repository URL
            </label>
            <input
              value={remote}
              onChange={(e) => setRemote(e.target.value)}
              placeholder="https://github.com/you/my-vault.git"
              className="w-full px-2.5 py-1.5 rounded-md border border-border bg-surface-0 text-sm text-text-primary focus:outline-none focus:border-accent"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[11px] uppercase tracking-wider text-text-muted">
              Branch
            </label>
            <input
              value={branch}
              onChange={(e) => setBranch(e.target.value)}
              className="w-full px-2.5 py-1.5 rounded-md border border-border bg-surface-0 text-sm text-text-primary focus:outline-none focus:border-accent"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[11px] uppercase tracking-wider text-text-muted">
              Personal Access Token
            </label>
            <input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="github_pat_…"
              className="w-full px-2.5 py-1.5 rounded-md border border-border bg-surface-0 text-sm font-mono text-text-primary focus:outline-none focus:border-accent"
            />
          </div>

          <div className="space-y-1">
            <label className="text-[11px] uppercase tracking-wider text-text-muted">
              Destination folder
            </label>
            <div className="flex gap-2">
              <input
                value={dest}
                onChange={(e) => setDest(e.target.value)}
                placeholder="/path/to/new/vault-folder"
                className="flex-1 px-2.5 py-1.5 rounded-md border border-border bg-surface-0 text-sm font-mono text-text-primary focus:outline-none focus:border-accent"
              />
              <Button variant="outline" size="sm" onClick={() => void pickDest()}>
                <FolderOpen size={12} className="mr-1.5" /> Pick
              </Button>
            </div>
          </div>

          {error && <div className="text-xs text-error break-words">{error}</div>}

          <Button onClick={() => void submit()} disabled={busy} className="w-full">
            {busy ? (
              <>
                <Loader2 size={14} className="animate-spin mr-2" /> Cloning…
              </>
            ) : (
              <>Clone & open vault</>
            )}
          </Button>

          <p className="text-[11px] text-text-muted leading-relaxed">
            Need a token?{' '}
            <button
              onClick={() => void openUrl(PAT_DOCS_URL)}
              className="text-accent hover:text-accent-bright underline"
            >
              How to create a fine-grained PAT
            </button>
            {' '}with <code>Contents: Read & Write</code>.
          </p>
        </div>
      </div>
    </div>
  );
}
