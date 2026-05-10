import { useVaultStore } from '@/stores/vault';
import { Logo } from '@/components/brand/Logo';

export function EmptyEditor() {
  const vaultRoot = useVaultStore((s) => s.vaultRoot);

  return (
    <div className="flex flex-col items-center justify-center h-full gap-5 text-text-muted">
      <span className="text-accent spore-breathe">
        <Logo size={112} glow />
      </span>
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
