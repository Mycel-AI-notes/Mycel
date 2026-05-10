import { FileText } from 'lucide-react';
import { useVaultStore } from '@/stores/vault';

export function EmptyEditor() {
  const vaultRoot = useVaultStore((s) => s.vaultRoot);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-4 text-text-muted">
      <FileText size={48} strokeWidth={1} className="opacity-30" />
      <div className="text-center">
        <p className="text-sm">No note open</p>
        {vaultRoot && (
          <p className="text-xs mt-1 opacity-60">Pick a file from the sidebar or create a new one</p>
        )}
      </div>
    </div>
  );
}
