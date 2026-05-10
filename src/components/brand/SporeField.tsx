import { clsx } from 'clsx';
import { RadialSpore } from './Spore';

/**
 * Onboarding ambient field — a colony of radial spores at varied
 * sizes, opacities and rotations. Each instance breathes on its own
 * stagger; large background spores rotate imperceptibly to keep the
 * field alive.
 *
 * Pure SVG via <RadialSpore>, layered with absolute-positioned divs.
 * Pointer-events disabled so it never intercepts the hero CTA.
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
  { top: '6%',  left: '8%',  size: 230, rotate:  18, opacity: 0.18, delay: 0,   glow: 10, spin: true },
  { top: '14%', left: '62%', size: 280, rotate: -22, opacity: 0.16, delay: 1.6, glow: 12, spin: true },
  { top: '58%', left: '72%', size: 210, rotate:  35, opacity: 0.20, delay: 3.0, glow: 10, spin: true },
  { top: '64%', left: '4%',  size: 190, rotate: -10, opacity: 0.18, delay: 4.0, glow:  9, spin: true },

  // Mid layer — medium opacity, more presence.
  { top: '40%', left: '32%', size: 130, rotate:  60, opacity: 0.32, delay: 0.8, glow:  8 },
  { top: '34%', left: '78%', size: 110, rotate: -45, opacity: 0.34, delay: 2.2, glow:  8 },
  { top: '78%', left: '40%', size: 120, rotate:  12, opacity: 0.30, delay: 3.6, glow:  8 },

  // Foreground accents — small, sharper, brighter.
  { top: '20%', left: '38%', size: 70,  rotate: -28, opacity: 0.55, delay: 1.0, glow:  6 },
  { top: '74%', left: '20%', size: 60,  rotate:  22, opacity: 0.55, delay: 2.8, glow:  6 },
  { top: '50%', left: '88%', size: 64,  rotate:  50, opacity: 0.50, delay: 4.4, glow:  6 },
  { top: '88%', left: '78%', size: 56,  rotate: -35, opacity: 0.52, delay: 0.4, glow:  6 },
  { top: '8%',  left: '88%', size: 54,  rotate:  10, opacity: 0.45, delay: 2.0, glow:  6 },
];

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
