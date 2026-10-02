import type { CSSProperties } from 'react';
import { useVaultStore } from '@/stores/vault';
import { Logo } from '@/components/brand/Logo';
import { SporeAir } from '@/components/fx/SporeAir';
import { useSporeMotion } from '@/hooks/useSporeMotion';

/** Grains the mark sheds: direction (px) and start offset (s). */
const SHED: ReadonlyArray<[number, number, number]> = [
  [-92, -70, 0],
  [104, -38, 0.8],
  [38, 96, 1.6],
  [-110, 30, 2.4],
  [70, -104, 3.1],
  [-46, 100, 3.9],
  [118, 62, 4.6],
];

export function EmptyEditor() {
  const vaultRoot = useVaultStore((s) => s.vaultRoot);
  const sporeMotion = useSporeMotion();

  return (
    <div className="relative flex flex-col items-center justify-center h-full gap-5 text-text-muted overflow-hidden select-none">
      {sporeMotion && <SporeAir />}

      <div className="relative z-10 flex flex-col items-center gap-5 pointer-events-none">
        <span className="relative text-accent">
          {sporeMotion && (
            <span aria-hidden="true" className="myc-shed">
              {SHED.map(([dx, dy, delay], i) => (
                <i
                  key={i}
                  style={
                    {
                      '--dx': `${dx}px`,
                      '--dy': `${dy}px`,
                      animationDelay: `${delay}s`,
                    } as CSSProperties
                  }
                />
              ))}
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
