import { clsx } from 'clsx';

/**
 * Tiny pulsing spore — used for living indicators (dirty tab, indexing).
 * Inherits color from parent via currentColor.
 */
export function PulseSpore({
  size = 10,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 10 10"
      aria-hidden="true"
      className={clsx('shrink-0', className)}
    >
      <g className="spore-pulse">
        <circle cx="5" cy="5" r="2.6" fill="currentColor" />
        <circle
          cx="5"
          cy="5"
          r="4"
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.45"
          strokeWidth="0.8"
        />
      </g>
    </svg>
  );
}

/**
 * Dormant spore — a calm hero glyph for empty editor states.
 * Soft halo breathes; the core stays still.
 */
export function DormantSpore({
  size = 72,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 80 80"
      aria-hidden="true"
      className={clsx('shrink-0', className)}
    >
      {/* outer breathing halo */}
      <circle
        cx="40"
        cy="40"
        r="28"
        fill="currentColor"
        className="spore-halo"
        opacity="0.18"
      />
      {/* mid ring */}
      <circle
        cx="40"
        cy="40"
        r="18"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.35"
        strokeWidth="1"
        strokeDasharray="3 3"
      />
      {/* mid body */}
      <circle cx="40" cy="40" r="11" fill="currentColor" opacity="0.55" />
      {/* core */}
      <circle cx="40" cy="40" r="6" fill="currentColor" className="spore-breathe" />
      {/* a couple of dormant satellite spores */}
      <circle cx="64" cy="22" r="1.6" fill="currentColor" opacity="0.55" />
      <circle cx="18" cy="58" r="1.4" fill="currentColor" opacity="0.45" />
      <circle cx="62" cy="60" r="1.2" fill="currentColor" opacity="0.4" />
      {/* faint hyphae reaching toward satellites */}
      <path
        d="M46 36 C 54 30, 60 26, 63 23"
        stroke="currentColor"
        strokeWidth="0.8"
        strokeOpacity="0.3"
        fill="none"
        strokeDasharray="2 3"
      />
      <path
        d="M34 46 C 28 50, 22 55, 19 57"
        stroke="currentColor"
        strokeWidth="0.8"
        strokeOpacity="0.25"
        fill="none"
        strokeDasharray="2 3"
      />
    </svg>
  );
}

/**
 * Disconnected spore — for "no results / no backlinks" empty states.
 * A small spore with a frayed, dashed thread fading into nothing.
 */
export function DisconnectedSpore({
  size = 32,
  className,
}: {
  size?: number;
  className?: string;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      className={clsx('shrink-0', className)}
    >
      <circle cx="12" cy="16" r="3.2" fill="currentColor" opacity="0.55" />
      <circle
        cx="12"
        cy="16"
        r="5"
        fill="none"
        stroke="currentColor"
        strokeOpacity="0.25"
        strokeWidth="0.7"
      />
      {/* broken hypha drifting off to the right */}
      <path
        d="M16 16 L 22 14"
        stroke="currentColor"
        strokeWidth="0.9"
        strokeOpacity="0.35"
        strokeDasharray="2 2"
        strokeLinecap="round"
      />
      <path
        d="M24 14 L 28 13"
        stroke="currentColor"
        strokeWidth="0.9"
        strokeOpacity="0.18"
        strokeDasharray="1 3"
        strokeLinecap="round"
      />
    </svg>
  );
}
