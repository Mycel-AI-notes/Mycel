import { useVaultStore } from '@/stores/vault';
import { Logo } from '@/components/brand/Logo';
import { Starfield } from '@/components/fx/Starfield';
import { useCosmicMotion } from '@/hooks/useCosmicMotion';

export function EmptyEditor() {
  const vaultRoot = useVaultStore((s) => s.vaultRoot);
  const cosmic = useCosmicMotion();

  return (
    <div className="relative flex flex-col items-center justify-center h-full gap-5 text-text-muted overflow-hidden select-none">
      {cosmic && <Starfield />}

      <div className="relative z-10 flex flex-col items-center gap-5 pointer-events-none">
        <span className="relative text-accent">
          {cosmic && (
            <span aria-hidden="true" className="cosmic-orbit">
              <span className="cosmic-orbit-moon" />
            </span>
          )}
          <span className="block spore-breathe">
            <Logo size={112} glow />
          </span>
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
    </div>
  );
}
