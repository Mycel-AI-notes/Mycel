import { clsx } from 'clsx';
import { RadialSpore } from './Spore';

/**
 * Onboarding ambient field — a colony of radial spores at varied
 * sizes, opacities and rotations, **wired together** by curved hyphae
 * so the screen reads as one connected mycelium rather than scattered
 * dots.
 *
 * The field is rendered in two layers (back to front):
 *   1. an SVG net of quadratic-Bezier hyphae in 0..100 percent space
 *   2. absolute-positioned <RadialSpore> instances on top
 *
 * Each spore breathes on its own stagger; the very large background
 * spores rotate imperceptibly. The connecting hyphae glow on a slow
 * staggered pulse via `.hypha-glow`.
 */

interface Instance {
  /** percent — top */
  top: string;
  /** percent — left */
  left: string;
  /** px diameter */
  size: number;
  /** initial rotation in deg */
  rotate: number;
  /** 0..1 — overall opacity, also used to imply depth */
  opacity: number;
  /** seconds — breathe animation delay */
  delay: number;
  /** strength of the accent glow */
  glow: number;
  /** if true — wrap in a slowly rotating group */
  spin?: boolean;
}

const INSTANCES: Instance[] = [
  // Large, soft, far-back spores set the depth.
  /* 0 */ { top: '6%',  left: '8%',  size: 230, rotate:  18, opacity: 0.18, delay: 0,   glow: 10, spin: true },
  /* 1 */ { top: '14%', left: '62%', size: 280, rotate: -22, opacity: 0.16, delay: 1.6, glow: 12, spin: true },
  /* 2 */ { top: '58%', left: '72%', size: 210, rotate:  35, opacity: 0.20, delay: 3.0, glow: 10, spin: true },
  /* 3 */ { top: '64%', left: '4%',  size: 190, rotate: -10, opacity: 0.18, delay: 4.0, glow:  9, spin: true },

  // Mid layer — medium opacity, more presence.
  /* 4 */ { top: '40%', left: '32%', size: 130, rotate:  60, opacity: 0.32, delay: 0.8, glow:  8 },
  /* 5 */ { top: '34%', left: '78%', size: 110, rotate: -45, opacity: 0.34, delay: 2.2, glow:  8 },
  /* 6 */ { top: '78%', left: '40%', size: 120, rotate:  12, opacity: 0.30, delay: 3.6, glow:  8 },

  // Foreground accents — small, sharper, brighter.
  /* 7 */ { top: '20%', left: '38%', size: 70,  rotate: -28, opacity: 0.55, delay: 1.0, glow:  6 },
  /* 8 */ { top: '74%', left: '20%', size: 60,  rotate:  22, opacity: 0.55, delay: 2.8, glow:  6 },
  /* 9 */ { top: '50%', left: '88%', size: 64,  rotate:  50, opacity: 0.50, delay: 4.4, glow:  6 },
  /* 10*/ { top: '88%', left: '78%', size: 56,  rotate: -35, opacity: 0.52, delay: 0.4, glow:  6 },
  /* 11*/ { top: '8%',  left: '88%', size: 54,  rotate:  10, opacity: 0.45, delay: 2.0, glow:  6 },
];

/**
 * Hyphae between spores — each tuple is `[fromIndex, toIndex, curve]`
 * where `curve` is the perpendicular offset of the Bezier control
 * point in percent units (sign decides the bow direction).
 *
 * Picked by visual proximity so the network reads as organically
 * grown rather than fully connected.
 */
const EDGES: ReadonlyArray<[number, number, number]> = [
  [0, 7,   3],
  [0, 4,  -4],
  [0, 3,   6],
  [3, 8,  -3],
  [3, 4,   5],
  [4, 6,   4],
  [4, 7,  -3],
  [7, 1,   4],
  [1, 11,  3],
  [1, 5,  -4],
  [11, 5, -3],
  [5, 9,   3],
  [5, 2,  -4],
  [2, 9,   3],
  [2, 10, -3],
  [6, 8,   4],
  [6, 10, -3],
  [9, 10,  4],
  [6, 2,  -5],
];

function pct(s: string): number {
  return parseFloat(s);
}

function edgePath(a: Instance, b: Instance, curve: number): string {
  const ax = pct(a.left);
  const ay = pct(a.top);
  const bx = pct(b.left);
  const by = pct(b.top);
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2;
  const dx = bx - ax;
  const dy = by - ay;
  const len = Math.hypot(dx, dy) || 1;
  // unit perpendicular
  const px = -dy / len;
  const py = dx / len;
  const cx = mx + px * curve;
  const cy = my + py * curve;
  return `M ${ax} ${ay} Q ${cx.toFixed(2)} ${cy.toFixed(2)} ${bx} ${by}`;
}

interface Props {
  className?: string;
}

export function SporeField({ className }: Props) {
  return (
    <div
      aria-hidden="true"
      className={clsx(
        'absolute inset-0 pointer-events-none overflow-hidden text-accent',
        className,
      )}
    >
      {/* Connecting hyphae — drawn first so they sit beneath the spores. */}
      <svg
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        className="absolute inset-0 w-full h-full"
        style={{
          filter: 'drop-shadow(0 0 4px color-mix(in srgb, currentColor 35%, transparent))',
        }}
      >
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="0.22"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        >
          {EDGES.map(([from, to, curve], i) => (
            <path
              key={`e${i}`}
              d={edgePath(INSTANCES[from], INSTANCES[to], curve)}
              className="hypha-glow"
              style={{ animationDelay: `${(i * 0.45) % 6}s` }}
            />
          ))}
        </g>
      </svg>

      {/* Spores layered on top of the network. */}
      {INSTANCES.map((s, i) => {
        const halfSize = s.size / 2;
        return (
          <div
            key={i}
            className="absolute"
            style={{
              top: s.top,
              left: s.left,
              width: s.size,
              height: s.size,
              marginTop: -halfSize,
              marginLeft: -halfSize,
              opacity: s.opacity,
            }}
          >
            <div
              className={clsx('w-full h-full', s.spin && 'spore-rotate')}
              style={s.spin ? { animationDelay: `${-s.delay * 8}s` } : undefined}
            >
              <div
                className="spore-breathe w-full h-full"
                style={{ animationDelay: `${s.delay}s` }}
              >
                <RadialSpore
                  size={s.size}
                  rotate={s.rotate}
                  glow={s.glow}
                  className="block"
                />
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
