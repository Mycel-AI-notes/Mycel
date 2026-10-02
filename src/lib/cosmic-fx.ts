import { useUIStore } from '@/stores/ui';

/**
 * Cosmic FX — a single full-window canvas that hosts every short-lived
 * flourish in the workspace: the nebula burst when a note or folder is
 * born, the comet that carries a note from the sidebar into the editor, and
 * the warp streaks when a vault opens.
 *
 * Design rules, so the effects never get in the way of writing:
 *   - the canvas never takes pointer events;
 *   - the RAF loop runs only while something is alive, then stops;
 *   - every effect is over in under a second;
 *   - the whole thing is a no-op when the user turned "Cosmic motion" off
 *     or the OS asks for reduced motion.
 */

type Kind = 'spark' | 'ring' | 'streak' | 'comet' | 'flash';

interface Particle {
  kind: Kind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  /** seconds lived */
  age: number;
  /** seconds to live */
  ttl: number;
  size: number;
  color: string;
  /** previous position, for motion tails */
  px: number;
  py: number;
  /** comet only — quadratic path */
  path?: { x0: number; y0: number; cx: number; cy: number; x1: number; y1: number };
  /** ring only — final radius */
  radius?: number;
  onDone?: () => void;
}

const reducedMotion =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

export function cosmicEnabled(): boolean {
  if (reducedMotion?.matches) return false;
  return useUIStore.getState().features.cosmic !== false;
}

/** Reads the live accent colours, so palette and theme switches just work. */
export function cosmicPalette() {
  const css = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) =>
    css.getPropertyValue(name).trim() || fallback;
  const dark = document.documentElement.classList.contains('dark');
  return {
    dark,
    accent: read('--color-accent', '#5C7012'),
    bright: read('--color-accent-bright', '#97B91E'),
    connected: read('--color-graph-connected', '#A7D129'),
    star: dark ? '#f4f7ee' : read('--color-accent-deep', '#3f4d0c'),
  };
}

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let particles: Particle[] = [];
let raf = 0;
let last = 0;
let dpr = 1;

function ensureCanvas(): CanvasRenderingContext2D | null {
  if (ctx && canvas?.isConnected) return ctx;
  canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.className = 'cosmic-fx-layer';
  document.body.appendChild(canvas);
  ctx = canvas.getContext('2d');
  resize();
  window.addEventListener('resize', resize);
  return ctx;
}

function resize() {
  if (!canvas) return;
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.round(window.innerWidth * dpr);
  canvas.height = Math.round(window.innerHeight * dpr);
}

function spawn(p: Omit<Particle, 'age' | 'px' | 'py'>) {
  particles.push({ ...p, age: 0, px: p.x, py: p.y });
}

function start() {
  if (raf) return;
  last = performance.now();
  raf = requestAnimationFrame(tick);
}

const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

function tick(now: number) {
  const c = ctx;
  if (!c || !canvas) {
    raf = 0;
    return;
  }
  const dt = Math.max(0, Math.min((now - last) / 1000, 1 / 20));
  last = now;

  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, canvas.width, canvas.height);
  const dark = document.documentElement.classList.contains('dark');
  c.globalCompositeOperation = dark ? 'lighter' : 'source-over';

  // Effects spawned mid-frame (comet dust) land in the fresh array and start
  // drawing next frame.
  const current = particles;
  particles = [];
  const alive: Particle[] = [];
  for (const p of current) {
    p.age += dt;
    const t = Math.min(p.age / p.ttl, 1);
    p.px = p.x;
    p.py = p.y;

    switch (p.kind) {
      case 'spark': {
        // Slight swirl + drag: sparks curl like gas leaving a nebula.
        const swirl = 2.2 * dt;
        const vx = p.vx * Math.cos(swirl) - p.vy * Math.sin(swirl);
        const vy = p.vx * Math.sin(swirl) + p.vy * Math.cos(swirl);
        const drag = Math.pow(0.04, dt);
        p.vx = vx * drag;
        p.vy = vy * drag;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const a = (1 - t) * (1 - t);
        c.strokeStyle = p.color;
        c.globalAlpha = a;
        c.lineWidth = p.size;
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(p.px - p.vx * dt * 3, p.py - p.vy * dt * 3);
        c.lineTo(p.x, p.y);
        c.stroke();
        break;
      }
      case 'ring': {
        const r = (p.radius ?? 40) * easeOutCubic(t);
        c.strokeStyle = p.color;
        c.globalAlpha = (1 - t) * 0.7;
        c.lineWidth = p.size * (1 - t * 0.7);
        c.beginPath();
        c.arc(p.x, p.y, r, 0, Math.PI * 2);
        c.stroke();
        break;
      }
      case 'flash': {
        const r = p.size * (0.6 + easeOutCubic(t) * 0.8);
        const g = c.createRadialGradient(p.x, p.y, 0, p.x, p.y, r);
        g.addColorStop(0, p.color);
        g.addColorStop(1, 'transparent');
        c.globalAlpha = (1 - t) * 0.9;
        c.fillStyle = g;
        c.beginPath();
        c.arc(p.x, p.y, r, 0, Math.PI * 2);
        c.fill();
        break;
      }
      case 'streak': {
        // Warp line: accelerate away from the origin, stretch as it goes.
        p.vx *= 1 + 3.2 * dt;
        p.vy *= 1 + 3.2 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        const a = Math.sin(Math.PI * t);
        c.strokeStyle = p.color;
        c.globalAlpha = a * 0.85;
        c.lineWidth = p.size;
        c.lineCap = 'round';
        c.beginPath();
        c.moveTo(p.x - p.vx * 0.06, p.y - p.vy * 0.06);
        c.lineTo(p.x, p.y);
        c.stroke();
        break;
      }
      case 'comet': {
        const path = p.path!;
        const k = easeInOutCubic(t);
        const u = 1 - k;
        p.x = u * u * path.x0 + 2 * u * k * path.cx + k * k * path.x1;
        p.y = u * u * path.y0 + 2 * u * k * path.cy + k * k * path.y1;
        // Tail: a few fading samples behind the head along the same curve.
        for (let i = 6; i >= 0; i--) {
          const kk = Math.max(0, k - i * 0.035);
          const uu = 1 - kk;
          const tx = uu * uu * path.x0 + 2 * uu * kk * path.cx + kk * kk * path.x1;
          const ty = uu * uu * path.y0 + 2 * uu * kk * path.cy + kk * kk * path.y1;
          c.globalAlpha = (1 - i / 7) * 0.55 * Math.min(1, (1 - t) * 4);
          c.fillStyle = p.color;
          c.beginPath();
          c.arc(tx, ty, p.size * (1 - i / 9), 0, Math.PI * 2);
          c.fill();
        }
        // Occasional dust shed from the head.
        if (Math.random() < 0.5) {
          spawnDust(p.x, p.y, p.color);
        }
        break;
      }
    }

    if (t < 1) alive.push(p);
    else p.onDone?.();
  }
  particles = alive.concat(particles);
  c.globalAlpha = 1;

  if (particles.length) {
    raf = requestAnimationFrame(tick);
  } else {
    c.clearRect(0, 0, canvas.width, canvas.height);
    raf = 0;
  }
}

function spawnDust(x: number, y: number, color: string) {
  const a = Math.random() * Math.PI * 2;
  const s = 10 + Math.random() * 30;
  spawn({
    kind: 'spark',
    x,
    y,
    vx: Math.cos(a) * s,
    vy: Math.sin(a) * s,
    ttl: 0.35 + Math.random() * 0.3,
    size: 1,
    color,
  });
}

/**
 * The visual anchor of a row: its entry icon (tree icons carry `shrink-0`;
 * a folder's chevron does not), else any icon, else the element itself.
 */
function iconOf(el: Element): Element {
  return el.querySelector('svg.shrink-0') ?? el.querySelector('svg') ?? el;
}

function centerOf(el: Element): { x: number; y: number } {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
}

/**
 * A small supernova: a white-hot flash, two shock rings and a swirl of
 * sparks. Used when something is born (note, folder) or on a click in the
 * empty starfield.
 */
export function nebulaBurst(x: number, y: number, opts: { scale?: number } = {}) {
  if (!cosmicEnabled() || !ensureCanvas()) return;
  const pal = cosmicPalette();
  const scale = opts.scale ?? 1;

  spawn({ kind: 'flash', x, y, vx: 0, vy: 0, ttl: 0.45, size: 22 * scale, color: pal.dark ? '#ffffff' : pal.bright });
  spawn({ kind: 'ring', x, y, vx: 0, vy: 0, ttl: 0.7, size: 1.6, radius: 34 * scale, color: pal.bright });
  spawn({ kind: 'ring', x, y, vx: 0, vy: 0, ttl: 1.0, size: 1, radius: 58 * scale, color: pal.accent });

  const n = Math.round(26 * scale);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + Math.random() * 0.4;
    const s = (90 + Math.random() * 150) * scale;
    spawn({
      kind: 'spark',
      x,
      y,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      ttl: 0.5 + Math.random() * 0.45,
      size: Math.random() < 0.25 ? 2 : 1.2,
      color: i % 3 === 0 ? pal.star : i % 3 === 1 ? pal.bright : pal.connected,
    });
  }
  start();
}

/** Burst centred on an element's icon (or the element itself). */
export function nebulaBurstAt(el: Element, opts?: { scale?: number }) {
  const { x, y } = centerOf(iconOf(el));
  nebulaBurst(x, y, opts);
}

/**
 * A comet arcing from `from` to `to`. Resolves when it lands, so callers can
 * chain a landing burst. Resolves immediately when motion is off.
 */
export function comet(from: Element, to: Element): Promise<void> {
  if (!cosmicEnabled() || !ensureCanvas()) return Promise.resolve();
  const pal = cosmicPalette();
  const { x: x0, y: y0 } = centerOf(iconOf(from));
  // Land where the note's first line will appear (below tabs + path bar).
  const tr = to.getBoundingClientRect();
  const x1 = tr.left + Math.min(72, tr.width / 2);
  const y1 = tr.top + Math.min(110, tr.height / 2);
  // Bow the path upward a little so it reads as a trajectory, not a slide.
  const cx = (x0 + x1) / 2;
  const cy = Math.min(y0, y1) - Math.max(40, Math.abs(x1 - x0) * 0.18);
  const dist = Math.hypot(x1 - x0, y1 - y0);

  return new Promise((resolve) => {
    spawn({
      kind: 'comet',
      x: x0,
      y: y0,
      vx: 0,
      vy: 0,
      ttl: Math.min(0.55, 0.28 + dist / 2600),
      size: 2.6,
      color: pal.bright,
      path: { x0, y0, cx, cy, x1, y1 },
      onDone: () => {
        spawn({ kind: 'ring', x: x1, y: y1, vx: 0, vy: 0, ttl: 0.5, size: 1.2, radius: 22, color: pal.bright });
        resolve();
      },
    });
    start();
  });
}

/**
 * Hyperspace exit: star streaks shooting outward from the window centre.
 * Plays once when a vault opens.
 */
export function warp() {
  if (!cosmicEnabled() || !ensureCanvas()) return;
  const pal = cosmicPalette();
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  const n = 90;
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = 8 + Math.random() * 90;
    const s = 60 + Math.random() * 160;
    spawn({
      kind: 'streak',
      x: cx + Math.cos(a) * r,
      y: cy + Math.sin(a) * r,
      vx: Math.cos(a) * s,
      vy: Math.sin(a) * s,
      ttl: 0.55 + Math.random() * 0.35,
      size: Math.random() < 0.2 ? 1.6 : 1,
      color: i % 4 === 0 ? pal.bright : pal.star,
    });
  }
  spawn({ kind: 'flash', x: cx, y: cy, vx: 0, vy: 0, ttl: 0.6, size: 120, color: pal.bright });
  start();
}

/**
 * Wait for a tree row with this path to be in the DOM, then celebrate its
 * birth. The tree re-renders after an async refresh, so poll a few frames.
 */
export function celebrateBirth(path: string) {
  if (!cosmicEnabled()) return;
  let tries = 0;
  const find = () => {
    const row = document.querySelector<HTMLElement>(
      `[data-tree-path="${CSS.escape(path)}"]`,
    );
    if (row) {
      row.classList.remove('cosmic-born');
      // Restart the CSS animation if the class was already there.
      void row.offsetWidth;
      row.classList.add('cosmic-born');
      row.addEventListener('animationend', () => row.classList.remove('cosmic-born'), {
        once: true,
      });
      nebulaBurstAt(row, { scale: 0.8 });
      return;
    }
    if (++tries < 30) requestAnimationFrame(find);
  };
  requestAnimationFrame(find);
}
