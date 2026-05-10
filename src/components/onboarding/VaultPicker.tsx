import { useCallback, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useVaultStore } from '@/stores/vault';
import { SporeField } from '@/components/brand/SporeField';
import { Logo } from '@/components/brand/Logo';

export function VaultPicker() {
  const { openVault } = useVaultStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handlePickFolder = useCallback(async () => {
    try {
      const selected = await open({ directory: true, multiple: false });
      if (!selected) return;
      setLoading(true);
      setError(null);
      await openVault(selected as string);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [openVault]);

  return (
    <div className="relative h-full overflow-hidden bg-surface-1">
      {/* Ambient mycelium colony — multiple radial spores drift behind the hero. */}
      <SporeField />

      {/* Subtle vignette so text stays legible over the field */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            'radial-gradient(ellipse at center, transparent 0%, var(--color-surface-1) 78%)',
        }}
      />

      <div className="relative z-10 flex flex-col items-center justify-center h-full gap-7 px-8">
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

        <div className="flex flex-col gap-3 w-full max-w-xs">
          <button
            onClick={handlePickFolder}
            disabled={loading}
            className="w-full py-3 px-4 rounded-lg bg-accent text-surface-0 font-medium hover:bg-accent-bright shadow-glow-sm hover:shadow-glow transition-all disabled:opacity-50 disabled:shadow-none"
          >
            {loading ? 'Opening…' : 'Open or Create Vault Folder'}
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
