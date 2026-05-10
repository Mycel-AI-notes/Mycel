import { useCallback, useState } from 'react';
import { open } from '@tauri-apps/plugin-dialog';
import { useVaultStore } from '@/stores/vault';

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
    <div className="flex flex-col items-center justify-center h-full gap-6 px-8">
      <div className="text-center">
        <h1 className="text-3xl font-bold text-text-primary mb-2">Mycel</h1>
        <p className="text-text-secondary text-sm max-w-sm">
          Local-first knowledge base with semantic search. Your notes, your machine, your rules.
        </p>
      </div>

      <div className="flex flex-col gap-3 w-full max-w-xs">
        <button
          onClick={handlePickFolder}
          disabled={loading}
          className="w-full py-3 px-4 rounded-lg bg-accent text-white font-medium hover:bg-accent/90 transition-colors disabled:opacity-50"
        >
          {loading ? 'Opening…' : 'Open or Create Vault Folder'}
        </button>
      </div>

      {error && (
        <p className="text-red-400 text-sm text-center max-w-sm">{error}</p>
      )}

      <p className="text-text-muted text-xs text-center max-w-xs">
        Choose any folder on your disk. Mycel will create a hidden <code className="font-mono">.mycel/</code> directory
        for its index — your notes stay as plain <code className="font-mono">.md</code> files.
      </p>
    </div>
  );
}
