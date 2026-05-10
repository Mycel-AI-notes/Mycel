import { clsx } from 'clsx';

/**
 * Ambient onboarding visual — a slow-breathing mycelium field of
 * spore nodes connected by curved hyphae. Lives behind hero text;
 * intentionally low-contrast so it sets a mood without competing.
 *
 * Pure SVG, scales to its container, animates via CSS keyframes
 * (see `index.css`). Respects `prefers-reduced-motion`.
 */

interface Node {
  x: number;
  y: number;
  r: number;
  /** Animation flavor — 'breathe' for soft scale, 'halo' for opacity halo. */
  kind: 'breathe' | 'halo' | 'still';
  /** seconds */
  delay?: number;
  opacity?: number;
}

const NODES: Node[] = [
  { x: 15, y: 22, r: 1.6, kind: 'breathe', delay: 0,    opacity: 0.85 },
  { x: 28, y: 58, r: 3.2, kind: 'halo',    delay: 0.6,  opacity: 0.9  },
  { x: 50, y: 18, r: 2.4, kind: 'breathe', delay: 1.2,  opacity: 0.8  },
  { x: 62, y: 72, r: 2.6, kind: 'halo',    delay: 2.0,  opacity: 0.85 },
  { x: 78, y: 32, r: 3.6, kind: 'breathe', delay: 0.3,  opacity: 0.9  },
  { x: 82, y: 86, r: 1.4, kind: 'breathe', delay: 1.8,  opacity: 0.7  },
  { x: 10, y: 80, r: 1.2, kind: 'still',                 opacity: 0.55 },
  { x: 45, y: 90, r: 1.5, kind: 'breathe', delay: 2.4,  opacity: 0.7  },
  { x: 40, y: 45, r: 1.1, kind: 'still',                 opacity: 0.5  },
  { x: 90, y: 55, r: 2.0, kind: 'breathe', delay: 1.0,  opacity: 0.8  },
];

interface Edge {
  /** Bezier-quadratic: from (x1,y1) via (cx,cy) to (x2,y2). */
  d: string;
  /** seconds — staggers the hypha-glow animation. */
  delay?: number;
  opacity?: number;
}

const EDGES: Edge[] = [
  { d: 'M15 22 Q 32 14, 50 18',     delay: 0,   opacity: 0.45 },
  { d: 'M50 18 Q 64 22, 78 32',     delay: 0.8, opacity: 0.5  },
  { d: 'M50 18 Q 46 30, 40 45',     delay: 1.4, opacity: 0.4  },
  { d: 'M40 45 Q 30 52, 28 58',     delay: 2.0, opacity: 0.45 },
  { d: 'M40 45 Q 52 58, 62 72',     delay: 0.5, opacity: 0.4  },
  { d: 'M28 58 Q 18 70, 10 80',     delay: 1.6, opacity: 0.35 },
  { d: 'M62 72 Q 70 80, 82 86',     delay: 2.6, opacity: 0.35 },
  { d: 'M62 72 Q 54 82, 45 90',     delay: 1.0, opacity: 0.4  },
  { d: 'M78 32 Q 88 42, 90 55',     delay: 0.2, opacity: 0.5  },
  { d: 'M90 55 Q 88 68, 82 86',     delay: 1.8, opacity: 0.35 },
  { d: 'M28 58 Q 34 50, 40 45',     delay: 2.2, opacity: 0.4  },
];

interface Props {
  className?: string;
}

export function SporeField({ className }: Props) {
  return (
    <svg
      viewBox="0 0 100 100"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      className={clsx(
        'absolute inset-0 w-full h-full pointer-events-none text-accent',
        className,
      )}
    >
      {/* hyphae first so spores render on top */}
      <g fill="none" stroke="currentColor" strokeLinecap="round">
        {EDGES.map((e, i) => (
          <path
            key={`e${i}`}
            d={e.d}
            strokeWidth="0.18"
            className="hypha-glow"
            style={{
              animationDelay: `${e.delay ?? 0}s`,
              opacity: e.opacity,
            }}
          />
        ))}
      </g>

      <g fill="currentColor">
        {NODES.map((n, i) => {
          const cls =
            n.kind === 'breathe'
              ? 'spore-breathe'
              : n.kind === 'halo'
                ? 'spore-halo'
                : undefined;
          return (
            <g key={`n${i}`} style={{ transformOrigin: `${n.x}px ${n.y}px` }}>
              {/* faint outer ring on the bigger nodes */}
              {n.r >= 2 && (
                <circle
                  cx={n.x}
                  cy={n.y}
                  r={n.r + 1.6}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="0.15"
                  opacity={(n.opacity ?? 0.7) * 0.4}
                />
              )}
              <circle
                cx={n.x}
                cy={n.y}
                r={n.r}
                opacity={n.opacity}
                className={cls}
                style={
                  cls && n.delay !== undefined
                    ? { animationDelay: `${n.delay}s`, transformOrigin: `${n.x}px ${n.y}px` }
                    : { transformOrigin: `${n.x}px ${n.y}px` }
                }
              />
            </g>
          );
        })}
      </g>
    </svg>
  );
}
