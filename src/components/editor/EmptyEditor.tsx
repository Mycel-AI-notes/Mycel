import { useVaultStore } from '@/stores/vault';
import { DormantSpore } from '@/components/brand/Spore';

export function EmptyEditor() {
  const vaultRoot = useVaultStore((s) => s.vaultRoot);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-5 text-text-muted">
      <DormantSpore size={88} className="text-accent-muted/80" />
      <div className="text-center">
        <p className="text-sm">No note open</p>
        {vaultRoot && (
          <p className="text-xs mt-1 opacity-60">
            Pick a note from the sidebar — or sprout a new one
          </p>
        )}
      </div>
    </div>
  );
}
