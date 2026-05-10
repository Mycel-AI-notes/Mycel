import { clsx } from 'clsx';

// ── Radial spore geometry ────────────────────────────────────────────────
//
// Branches radiate from (50, 50) in a 100×100 viewBox. Each branch is a
// quadratic Bezier with a perpendicular curve offset; some carry a
// mid-bud for variety. The shape mimics a mycelium fruiting body —
// central globe, ten curved hyphae, terminal spores.

interface Branch {
  /** angle in degrees, 0 = right, increases CCW */
  angle: number;
  /** length from centre to terminal spore */
  len: number;
  /** terminal spore radius */
  term: number;
  /** perpendicular curve offset; sign decides the side */
  curve: number;
  /** if set: a mid-bud at this fraction of the path (0..1) with that radius */
  mid?: { at: number; r: number };
}

const BRANCHES: Branch[] = [
  { angle: -90, len: 32, term: 4.0, curve:  3 },
  { angle: -55, len: 22, term: 2.4, curve: -3, mid: { at: 0.55, r: 1.6 } },
  { angle: -22, len: 30, term: 3.6, curve:  4 },
  { angle:  18, len: 24, term: 2.6, curve: -3, mid: { at: 0.6,  r: 1.5 } },
  { angle:  55, len: 30, term: 3.4, curve:  3 },
  { angle:  92, len: 24, term: 2.4, curve: -4, mid: { at: 0.5,  r: 1.6 } },
  { angle: 130, len: 30, term: 3.8, curve:  4 },
  { angle: 165, len: 22, term: 2.4, curve: -3, mid: { at: 0.55, r: 1.5 } },
  { angle: 200, len: 30, term: 3.6, curve:  4 },
  { angle: 240, len: 23, term: 2.6, curve: -3, mid: { at: 0.55, r: 1.5 } },
];

const toRad = (deg: number) => (deg * Math.PI) / 180;

function polar(cx: number, cy: number, deg: number, r: number): [number, number] {
  return [cx + Math.cos(toRad(deg)) * r, cy + Math.sin(toRad(deg)) * r];
}

function branchPath(b: Branch): { d: string; end: [number, number]; midPos?: [number, number] } {
  const cx = 50;
  const cy = 50;
  const [ex, ey] = polar(cx, cy, b.angle, b.len);
  const [mx, my] = polar(cx, cy, b.angle, b.len * 0.5);
  const [ctrlX, ctrlY] = polar(mx, my, b.angle + 90, b.curve);
  const midPos = b.mid ? polar(cx, cy, b.angle, b.len * b.mid.at) : undefined;
  return { d: `M ${cx} ${cy} Q ${ctrlX.toFixed(2)} ${ctrlY.toFixed(2)} ${ex.toFixed(2)} ${ey.toFixed(2)}`, end: [ex, ey], midPos };
}

interface RadialSporeProps {
  size?: number;
  rotate?: number;
  className?: string;
  /** strength of the accent drop-shadow glow (0 = off) */
  glow?: number;
  style?: React.CSSProperties;
}

/**
 * The full radial-spore organism — central globe + 10 curved hyphae,
 * terminal spores and occasional mid-buds. Used as the onboarding's
 * ambient mycelium population and as the large brand glyph.
 */
export function RadialSpore({
  size = 120,
  rotate = 0,
  className,
  glow = 8,
  style,
}: RadialSporeProps) {
  const branches = BRANCHES.map(branchPath);
  return (
    <svg
      width={size}
      height={size}
      viewBox="-10 -10 120 120"
      aria-hidden="true"
      className={clsx('shrink-0', className)}
      style={{
        transform: rotate ? `rotate(${rotate}deg)` : undefined,
        filter: glow > 0
          ? `drop-shadow(0 0 ${glow}px color-mix(in srgb, currentColor 55%, transparent))`
          : undefined,
        ...style,
      }}
    >
      {/* hyphae */}
      <g
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
      >
        {branches.map((b, i) => (
          <path key={`h${i}`} d={b.d} />
        ))}
      </g>

      {/* mid-buds */}
      <g fill="currentColor" opacity="0.85">
        {branches.map(
          (b, i) =>
            b.midPos && (
              <circle
                key={`m${i}`}
                cx={b.midPos[0].toFixed(2)}
                cy={b.midPos[1].toFixed(2)}
                r={BRANCHES[i].mid!.r}
              />
            ),
        )}
      </g>

      {/* terminal spores */}
      <g fill="currentColor">
        {branches.map((b, i) => (
          <circle
            key={`t${i}`}
            cx={b.end[0].toFixed(2)}
            cy={b.end[1].toFixed(2)}
            r={BRANCHES[i].term}
          />
        ))}
      </g>

      {/* central globe — soft halo + dense core gives the sphere read */}
      <circle cx="50" cy="50" r="11" fill="currentColor" opacity="0.22" />
      <circle cx="50" cy="50" r="7.5" fill="currentColor" opacity="0.6" />
      <circle cx="50" cy="50" r="5" fill="currentColor" />
    </svg>
  );
}

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
