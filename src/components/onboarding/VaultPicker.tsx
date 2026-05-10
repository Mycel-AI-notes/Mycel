import { useCallback, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { Folder, FolderOpen, X, Plus } from 'lucide-react';
import { useVaultStore } from '@/stores/vault';
import { useRecentVaults, vaultDisplayName } from '@/stores/recentVaults';
import { SporeField } from '@/components/brand/SporeField';
import { Logo } from '@/components/brand/Logo';

export function VaultPicker() {
  const { openVault } = useVaultStore();
  const recents = useRecentVaults((s) => s.recents);
  const removeRecent = useRecentVaults((s) => s.remove);
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleOpen = useCallback(
    async (path: string) => {
      try {
        setLoading(path);
        setError(null);
        await openVault(path);
      } catch (e) {
        setError(String(e));
        // If the folder is gone, forget it.
        removeRecent(path);
      } finally {
        setLoading(null);
      }
    },
    [openVault, removeRecent],
  );

  const handlePickFolder = useCallback(async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (!selected) return;
      await handleOpen(selected as string);
    } catch (e) {
      setError(String(e));
    }
  }, [handleOpen]);

  return (
    <div className="relative h-full overflow-hidden bg-surface-1">
      <SporeField />

      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 0%, var(--color-surface-1) 78%)',
        }}
      />

      <div className="relative z-10 flex flex-col items-center justify-center h-full gap-7 px-8 py-10 overflow-y-auto">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="text-accent">
            <Logo size={72} glow />
          </span>
          <h1 className="text-3xl font-semibold tracking-tight text-text-primary">
            Mycel
          </h1>
          <p className="text-text-secondary text-sm max-w-sm leading-relaxed">
            A living knowledge network. Local-first notes,
            <br />
            connected by semantic mycelium.
          </p>
        </div>

        <div className="flex flex-col gap-3 w-full max-w-sm">
          {recents.length > 0 && (
            <div className="flex flex-col gap-1">
              <div className="flex items-center justify-between px-1 pb-1">
                <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
                  Recent vaults
                </span>
              </div>
              <ul className="flex flex-col gap-1 rounded-lg border border-border bg-surface-0/70 backdrop-blur-sm p-1">
                {recents.map((path) => {
                  const name = vaultDisplayName(path);
                  const isLoading = loading === path;
                  return (
                    <li key={path}>
                      <div className="group flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-surface-hover">
                        <button
                          onClick={() => handleOpen(path)}
                          disabled={isLoading}
                          className="flex-1 min-w-0 flex items-center gap-2 text-left disabled:opacity-50"
                          title={path}
                        >
                          <Folder
                            size={14}
                            className="shrink-0 text-accent-deep group-hover:text-accent"
                          />
                          <div className="flex-1 min-w-0">
                            <div className="text-sm text-text-primary truncate">
                              {isLoading ? 'Opening…' : name}
                            </div>
                            <div className="text-[11px] text-text-muted truncate font-mono">
                              {path}
                            </div>
                          </div>
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            removeRecent(path);
                          }}
                          className="p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-error/15 text-text-muted hover:text-error transition-opacity"
                          title="Remove from recents"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          <button
            onClick={handlePickFolder}
            disabled={loading !== null}
            className="w-full py-3 px-4 rounded-lg bg-accent text-surface-0 font-medium hover:bg-accent-bright shadow-glow-sm hover:shadow-glow transition-all disabled:opacity-50 disabled:shadow-none flex items-center justify-center gap-2"
          >
            {recents.length > 0 ? (
              <>
                <Plus size={16} /> Open another vault…
              </>
            ) : (
              <>
                <FolderOpen size={16} /> Open or Create Vault Folder
              </>
            )}
          </button>
        </div>

        {error && (
          <p className="text-error text-sm text-center max-w-sm">{error}</p>
        )}

        <p className="text-text-muted text-xs text-center max-w-xs leading-relaxed">
          Pick any folder. Mycel grows a hidden{' '}
          <code className="font-mono text-accent-muted">.mycel/</code> index inside —
          your notes stay as plain <code className="font-mono">.md</code> files.
        </p>
      </div>
    </div>
  );
}
