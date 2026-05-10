import { clsx } from 'clsx';
import { BRANCHES_COMPACT, buildBranchGeometry } from './Spore';

interface LogoProps {
  size?: number;
  className?: string;
  withWordmark?: boolean;
  /** Add a soft accent drop-shadow glow around the mark. */
  glow?: boolean;
}

/**
 * Mycel mark — a compact radial spore: a central globe ringed by 7
 * curved hyphae of varied length and direction, with one Y-fork and a
 * couple of mid-buds. Asymmetric on purpose — a uniform N-pointed star
 * reads as a primitive, not as a living organism.
 *
 * Inherits color from the parent via currentColor.
 */
export function Logo({ size = 18, className, withWordmark = false, glow = false }: LogoProps) {
  const branches = buildBranchGeometry(BRANCHES_COMPACT, 12, 12);
  return (
    <span className={clsx('inline-flex items-center gap-2 select-none', className)}>
      <svg
        width={size}
        height={size}
        viewBox="-2 -2 28 28"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
        style={
          glow
            ? { filter: 'drop-shadow(0 0 6px color-mix(in srgb, currentColor 55%, transparent))' }
            : undefined
        }
      >
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="1.4"
          strokeLinecap="round"
        >
          {branches.map((b, i) => (
            <path key={`h${i}`} d={b.d} />
          ))}
          {branches.map(
            (b, i) =>
              b.fork && (
                <g key={`f${i}`}>
                  <path d={b.fork.leftPath} />
                  <path d={b.fork.rightPath} />
                </g>
              ),
          )}
        </g>

        <g fill="currentColor" opacity="0.85">
          {branches.map(
            (b, i) =>
              b.midPos && (
                <circle key={`m${i}`} cx={b.midPos[0]} cy={b.midPos[1]} r={b.midR} />
              ),
          )}
        </g>

        <g fill="currentColor">
          {branches.map((b, i) =>
            b.termR ? (
              <circle key={`t${i}`} cx={b.end[0]} cy={b.end[1]} r={b.termR} />
            ) : null,
          )}
          {branches.map(
            (b, i) =>
              b.fork && (
                <g key={`ft${i}`}>
                  <circle cx={b.fork.leftTip[0]} cy={b.fork.leftTip[1]} r={b.fork.tipR} />
                  <circle cx={b.fork.rightTip[0]} cy={b.fork.rightTip[1]} r={b.fork.tipR} />
                </g>
              ),
          )}
        </g>

        {/* central globe — halo + dense core */}
        <circle cx="12" cy="12" r="3.0" fill="currentColor" opacity="0.25" />
        <circle cx="12" cy="12" r="2.0" fill="currentColor" opacity="0.6" />
        <circle cx="12" cy="12" r="1.4" fill="currentColor" />
      </svg>

      {withWordmark && (
        <span className="font-semibold tracking-wide text-[13px] leading-none">mycel</span>
      )}
    </span>
  );
}
