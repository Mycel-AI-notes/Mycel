import { clsx } from 'clsx';
import mycelIcon from '@/assets/mycel-icon.png';

interface LogoProps {
  size?: number;
  className?: string;
  withWordmark?: boolean;
  /** Add a soft accent glow around the mark. */
  glow?: boolean;
}

/**
 * Mycel mark — the app icon itself: the glowing glassy mycelium "M" on its
 * rounded tile, so the window, the dock and the UI all show one mark.
 */
export function Logo({ size = 18, className, withWordmark = false, glow = false }: LogoProps) {
  return (
    <span className={clsx('inline-flex items-center gap-2 select-none', className)}>
      <img
        src={mycelIcon}
        width={size}
        height={size}
        alt=""
        aria-hidden="true"
        draggable={false}
        className="shrink-0"
        style={
          glow
            ? { filter: 'drop-shadow(0 0 6px color-mix(in srgb, var(--color-accent) 45%, transparent))' }
            : undefined
        }
      />
      {withWordmark && (
        <span className="font-semibold tracking-wide text-[13px] leading-none">mycel</span>
      )}
    </span>
  );
}
