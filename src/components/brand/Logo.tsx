import { clsx } from 'clsx';

interface LogoProps {
  size?: number;
  className?: string;
  withWordmark?: boolean;
  /** Add a soft accent drop-shadow glow around the mark. */
  glow?: boolean;
}

/**
 * Mycel mark — a radial spore: a central globe ringed by curved hyphae,
 * each tipped with a smaller terminal spore. Some hyphae carry a tiny
 * mid-bud — the "branching" tell of a living mycelium.
 *
 * Uses currentColor so it inherits accent / muted tones from the parent.
 * Optimized for small toolbar sizes (16–24px) but scales cleanly up to
 * the onboarding hero.
 */
export function Logo({ size = 18, className, withWordmark = false, glow = false }: LogoProps) {
  // viewBox is generous (-4..32) so the optional glow filter has room.
  return (
    <span className={clsx('inline-flex items-center gap-2 select-none', className)}>
      <svg
        width={size}
        height={size}
        viewBox="-4 -4 32 32"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
        style={
          glow
            ? { filter: 'drop-shadow(0 0 6px color-mix(in srgb, currentColor 55%, transparent))' }
            : undefined
        }
      >
        {/* hyphae — curved Bezier paths radiating from the centre */}
        <g
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          fill="none"
          opacity="0.95"
        >
          <path d="M12 12 Q 11.5 7.5 11 3" />
          <path d="M12 12 Q 16.5 8 19.5 5.5" />
          <path d="M12 12 Q 19.5 11 22.5 12.5" />
          <path d="M12 12 Q 17 16.5 18.5 21" />
          <path d="M12 12 Q 11.5 17 12 22" />
          <path d="M12 12 Q 6.5 16 4 19" />
          <path d="M12 12 Q 3.5 13 1.5 11.5" />
          <path d="M12 12 Q 6.5 8.5 4 5.5" />
        </g>

        {/* terminal spores at the end of each hypha */}
        <g fill="currentColor">
          <circle cx="11" cy="3"   r="1.4" />
          <circle cx="19.5" cy="5.5" r="1.5" />
          <circle cx="22.5" cy="12.5" r="1.4" />
          <circle cx="18.5" cy="21" r="1.5" />
          <circle cx="12" cy="22"  r="1.4" />
          <circle cx="4"  cy="19"  r="1.5" />
          <circle cx="1.5" cy="11.5" r="1.3" />
          <circle cx="4"  cy="5.5" r="1.4" />
        </g>

        {/* central globe — a soft "halo" + dense core suggests sphericality */}
        <circle cx="12" cy="12" r="3.4" fill="currentColor" opacity="0.25" />
        <circle cx="12" cy="12" r="2.4" fill="currentColor" />
      </svg>

      {withWordmark && (
        <span className="font-semibold tracking-wide text-[13px] leading-none">mycel</span>
      )}
    </span>
  );
}
