import { useUIStore } from '@/stores/ui';
import { BRANCHES_FULL, type Branch } from '@/components/brand/Spore';

/**
 * Spore FX — the life cycle of a fungus, played out on one full-window
 * canvas. Every flourish in the workspace is a stage of it:
 *
 *   spore      → a glowing grain drifting on air (the field, released spores)
 *   germinate  → a spore sprouts the Mycel mark: the same asymmetric hyphae,
 *                mid-buds, Y-fork and terminal spores as the logo, grown
 *                live (a vault opening, a note or folder being born, a click)
 *   reach      → a single hypha grows from one place to another and roots
 *                where it lands (a note travelling from the tree to the editor)
 *
 * Rules, so none of it gets in the way of writing:
 *   - the canvas never takes pointer events;
 *   - the RAF loop runs only while something is alive, then stops;
 *   - every effect is gone in about a second;
 *   - it is all a no-op when "Spore motion" is off or the OS asks for
 *     reduced motion.
 */

// ── Palette & gating ────────────────────────────────────────────────────

const reducedMotion =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

export function sporeMotionEnabled(): boolean {
  if (reducedMotion?.matches) return false;
  return useUIStore.getState().features.sporeMotion !== false;
}

/** Live accent colours, so palette and theme switches just work. */
export function sporePalette() {
  const css = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) =>
    css.getPropertyValue(name).trim() || fallback;
  const dark = document.documentElement.classList.contains('dark');
  return {
    dark,
    /** hyphae */
    thread: read('--color-accent', '#5C7012'),
    /** spores, growing tips */
    glow: read('--color-accent-bright', '#97B91E'),
    soft: read('--color-graph-connected', '#A7D129'),
    /** airborne spores — pale in the dark, deep in the light */
    grain: dark ? read('--color-graph-connected', '#A7D129') : read('--color-accent-deep', '#3f4d0c'),
  };
}

export type SporePalette = ReturnType<typeof sporePalette>;

// ── Drawing primitives (shared with the spore field) ────────────────────

/** A spore: soft halo + dense core — the same globe read as the logo. */
export function drawSpore(
  c: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  color: string,
  alpha: number,
) {
  if (r <= 0 || alpha <= 0) return;
  c.fillStyle = color;
  c.globalAlpha = alpha * 0.18;
  c.beginPath();
  c.arc(x, y, r * 2.4, 0, Math.PI * 2);
  c.fill();
  c.globalAlpha = alpha * 0.45;
  c.beginPath();
  c.arc(x, y, r * 1.5, 0, Math.PI * 2);
  c.fill();
  c.globalAlpha = alpha;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();
}

interface Quad {
  x0: number;
  y0: number;
  cx: number;
  cy: number;
  x1: number;
  y1: number;
}

function quadAt(q: Quad, t: number): [number, number] {
  const u = 1 - t;
  return [
    u * u * q.x0 + 2 * u * t * q.cx + t * t * q.x1,
    u * u * q.y0 + 2 * u * t * q.cy + t * t * q.y1,
  ];
}

/** Stroke a quadratic from t=0 to t=`to` — a hypha caught mid-growth. */
function strokeQuad(c: CanvasRenderingContext2D, q: Quad, to: number) {
  const steps = 14;
  c.beginPath();
  c.moveTo(q.x0, q.y0);
  for (let i = 1; i <= steps; i++) {
    const [x, y] = quadAt(q, (i / steps) * to);
    c.lineTo(x, y);
  }
  c.stroke();
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
/** Small overshoot — spores "pop" into being. */
const easeBack = (t: number) => {
  const k = 1.9;
  return 1 + (k + 1) * Math.pow(t - 1, 3) + k * Math.pow(t - 1, 2);
};

// ── Organisms ───────────────────────────────────────────────────────────

interface Hypha {
  kind: 'hypha';
  q: Quad;
  width: number;
  /** seconds before it starts growing */
  delay: number;
  grow: number;
  hold: number;
  fade: number;
  age: number;
  /** terminal spore radius; 0 for none */
  tip: number;
  mid?: { at: number; r: number };
  /** release an airborne spore from the tip when grown */
  release?: boolean;
  /** called once, when the tip arrives */
  onTip?: () => void;
  tipped?: boolean;
}

interface Globe {
  kind: 'globe';
  x: number;
  y: number;
  r: number;
  age: number;
  ttl: number;
}

interface Airborne {
  kind: 'spore';
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  age: number;
  ttl: number;
  phase: number;
}

interface Pulse {
  kind: 'pulse';
  x: number;
  y: number;
  radius: number;
  age: number;
  ttl: number;
}

type Organism = Hypha | Globe | Airborne | Pulse;

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let alive: Organism[] = [];
let raf = 0;
let last = 0;
let dpr = 1;
let pal: SporePalette | null = null;

function ensureCanvas(): CanvasRenderingContext2D | null {
  if (ctx && canvas?.isConnected) return ctx;
  canvas = document.createElement('canvas');
  canvas.setAttribute('aria-hidden', 'true');
  canvas.className = 'myc-fx-layer';
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

function start() {
  pal = sporePalette();
  if (raf) return;
  last = performance.now();
  raf = requestAnimationFrame(tick);
}

function release(x: number, y: number, r = 1.2, speed = 30) {
  const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
  alive.push({
    kind: 'spore',
    x,
    y,
    vx: Math.cos(a) * speed * (0.5 + Math.random()),
    vy: Math.sin(a) * speed * (0.5 + Math.random()),
    r: r * (0.7 + Math.random() * 0.6),
    age: 0,
    ttl: 0.9 + Math.random() * 0.7,
    phase: Math.random() * Math.PI * 2,
  });
}

function tick(now: number) {
  const c = ctx;
  if (!c || !canvas || !pal) {
    raf = 0;
    return;
  }
  const dt = Math.max(0, Math.min((now - last) / 1000, 1 / 20));
  last = now;

  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, canvas.width / dpr, canvas.height / dpr);
  c.globalCompositeOperation = pal.dark ? 'lighter' : 'source-over';
  c.lineCap = 'round';

  // Organisms born mid-frame (released spores, fork branches) land in the
  // fresh array and start next frame.
  const current = alive;
  alive = [];
  const keep: Organism[] = [];

  for (const o of current) {
    o.age += dt;
    let done = false;

    switch (o.kind) {
      case 'hypha': {
        const t = o.age - o.delay;
        if (t <= 0) break;
        const g = Math.min(t / o.grow, 1);
        const life = o.grow + o.hold + o.fade;
        const a = t < o.grow + o.hold ? 1 : Math.max(0, 1 - (t - o.grow - o.hold) / o.fade);
        const reach = easeOut(g);

        c.strokeStyle = pal.thread;
        c.lineWidth = o.width;
        c.globalAlpha = a * 0.9;
        strokeQuad(c, o.q, reach);

        if (o.mid && reach >= o.mid.at) {
          const [mx, my] = quadAt(o.q, o.mid.at);
          const pop = easeBack(Math.min(1, (reach - o.mid.at) / 0.25));
          drawSpore(c, mx, my, o.mid.r * pop, pal.thread, a * 0.85);
        }

        const [tx, ty] = quadAt(o.q, reach);
        if (g < 1) {
          // The growing tip glows — that's where the hypha is alive.
          drawSpore(c, tx, ty, o.width * 0.9, pal.glow, a);
        } else {
          if (!o.tipped) {
            o.tipped = true;
            if (o.release) release(tx, ty, Math.max(1, o.tip * 0.6));
            o.onTip?.();
          }
          if (o.tip > 0) {
            const pop = easeBack(Math.min(1, (t - o.grow) / 0.18));
            drawSpore(c, tx, ty, o.tip * pop, pal.glow, a);
          }
        }
        done = t >= life;
        break;
      }
      case 'globe': {
        const t = o.age / o.ttl;
        const grow = easeBack(Math.min(1, o.age / 0.22));
        const a = t < 0.6 ? 1 : Math.max(0, 1 - (t - 0.6) / 0.4);
        drawSpore(c, o.x, o.y, o.r * grow, pal.glow, a);
        done = t >= 1;
        break;
      }
      case 'spore': {
        // Airborne: rises, wobbles, slows, fades.
        const drag = Math.pow(0.25, dt);
        o.vx = o.vx * drag + Math.sin(o.age * 6 + o.phase) * 14 * dt;
        o.vy = o.vy * drag - 10 * dt;
        o.x += o.vx * dt;
        o.y += o.vy * dt;
        const t = o.age / o.ttl;
        drawSpore(c, o.x, o.y, o.r, pal.soft, (1 - t) * 0.9);
        done = t >= 1;
        break;
      }
      case 'pulse': {
        const t = o.age / o.ttl;
        c.strokeStyle = pal.glow;
        c.lineWidth = 1;
        c.globalAlpha = (1 - t) * 0.22;
        c.beginPath();
        c.arc(o.x, o.y, o.radius * easeOut(t), 0, Math.PI * 2);
        c.stroke();
        done = t >= 1;
        break;
      }
    }

    if (!done) keep.push(o);
  }

  alive = keep.concat(alive);
  c.globalAlpha = 1;

  if (alive.length) {
    raf = requestAnimationFrame(tick);
  } else {
    c.clearRect(0, 0, canvas.width, canvas.height);
    raf = 0;
  }
}

// ── Effects ─────────────────────────────────────────────────────────────

const rad = (deg: number) => (deg * Math.PI) / 180;

/**
 * Grow one branch of the Mycel mark at (x, y). `unit` converts the logo's
 * geometry (lengths ~16..36 around a centre of r=5) into pixels.
 */
function growBranch(
  x: number,
  y: number,
  b: Branch,
  rot: number,
  unit: number,
  delay: number,
  timing: { grow: number; hold: number; fade: number },
  releaseSpores: boolean,
) {
  const ang = rad(b.angle + rot);
  const len = b.len * unit;
  const x1 = x + Math.cos(ang) * len;
  const y1 = y + Math.sin(ang) * len;
  const mx = x + Math.cos(ang) * len * 0.5;
  const my = y + Math.sin(ang) * len * 0.5;
  const perp = ang + Math.PI / 2;
  const q: Quad = {
    x0: x,
    y0: y,
    cx: mx + Math.cos(perp) * b.curve * unit,
    cy: my + Math.sin(perp) * b.curve * unit,
    x1,
    y1,
  };
  const width = Math.min(3, Math.max(1, unit));

  alive.push({
    kind: 'hypha',
    q,
    width,
    delay,
    ...timing,
    age: 0,
    tip: b.fork ? 0 : Math.min(7, b.term * unit * 0.55),
    mid: b.mid ? { at: b.mid.at, r: b.mid.r * unit * 0.55 } : undefined,
    release: releaseSpores && !b.fork,
    onTip: b.fork
      ? () => {
          // Y-fork: two short branches sprout from the tip.
          for (const side of [-1, 1]) {
            const fa = ang + rad(b.fork!.spread) * side;
            const fl = b.fork!.tipLen * unit;
            alive.push({
              kind: 'hypha',
              q: {
                x0: x1,
                y0: y1,
                cx: x1 + Math.cos(fa) * fl * 0.5,
                cy: y1 + Math.sin(fa) * fl * 0.5,
                x1: x1 + Math.cos(fa) * fl,
                y1: y1 + Math.sin(fa) * fl,
              },
              width,
              delay: 0,
              grow: timing.grow * 0.35,
              hold: Math.max(0, timing.hold - timing.grow * 0.35),
              fade: timing.fade,
              age: 0,
              tip: b.fork!.tipR * unit * 0.55,
              release: releaseSpores,
            });
          }
        }
      : undefined,
  });
}

export interface GerminateOptions {
  /** radius of the grown mark, px (the longest hypha) */
  size?: number;
  /** release airborne spores from the tips */
  spores?: boolean;
  /** seconds the grown mark stays before fading */
  hold?: number;
}

/**
 * A spore germinates into the Mycel mark: the globe swells, then the
 * hyphae grow out one after another, buds and forks appear, terminal
 * spores pop — and release spores into the air.
 */
export function germinate(x: number, y: number, opts: GerminateOptions = {}) {
  if (!sporeMotionEnabled() || !ensureCanvas()) return;
  const size = opts.size ?? 28;
  const unit = size / 36; // longest branch in BRANCHES_FULL is 36
  const rot = Math.random() * 360;
  const hold = opts.hold ?? 0.25;
  const timing = { grow: 0.32, hold, fade: 0.4 };

  alive.push({ kind: 'globe', x, y, r: Math.min(9, Math.max(2, 5 * unit)), age: 0, ttl: 0.12 + timing.grow + hold + timing.fade + 0.2 });
  alive.push({ kind: 'pulse', x, y, radius: size * 1.15, age: 0, ttl: 0.8 });

  // Grow branches in angular order with a slight stagger — reads as one
  // organism unfolding rather than a burst.
  BRANCHES_FULL.forEach((b, i) =>
    growBranch(x, y, b, rot, unit, 0.08 + i * 0.022, timing, opts.spores ?? true),
  );
  start();
}

/** Germinate on an element's entry icon (or the element itself). */
export function germinateAt(el: Element, opts?: GerminateOptions) {
  const { x, y } = centerOf(iconOf(el));
  germinate(x, y, opts);
}

/**
 * A single hypha grows from `from` to `to`, budding on the way, and roots
 * into a small mark where it lands. Resolves on arrival.
 */
export function reach(from: Element, to: Element): Promise<void> {
  if (!sporeMotionEnabled() || !ensureCanvas()) return Promise.resolve();
  const { x: x0, y: y0 } = centerOf(iconOf(from));
  // Land where the note's first line will appear (below tabs + path bar).
  const tr = to.getBoundingClientRect();
  const x1 = tr.left + Math.min(72, tr.width / 2);
  const y1 = tr.top + Math.min(110, tr.height / 2);
  const dist = Math.hypot(x1 - x0, y1 - y0);
  // Hyphae wander: bow the path, a little differently each time.
  const bow = (Math.random() < 0.5 ? -1 : 1) * Math.max(30, dist * 0.16);
  const nx = -(y1 - y0) / (dist || 1);
  const ny = (x1 - x0) / (dist || 1);
  const q: Quad = {
    x0,
    y0,
    cx: (x0 + x1) / 2 + nx * bow,
    cy: (y0 + y1) / 2 + ny * bow,
    x1,
    y1,
  };
  const grow = Math.min(0.5, 0.26 + dist / 3000);

  // Side buds along the way: short lateral hyphae branching off as the
  // main one passes.
  for (const at of [0.32, 0.58, 0.8]) {
    const [bx, by] = quadAt(q, at);
    const [ax, ay] = quadAt(q, at + 0.01);
    const along = Math.atan2(ay - by, ax - bx);
    const side = Math.random() < 0.5 ? -1 : 1;
    const ang = along + side * rad(40 + Math.random() * 25);
    const l = 8 + Math.random() * 8;
    alive.push({
      kind: 'hypha',
      q: {
        x0: bx,
        y0: by,
        cx: bx + Math.cos(ang) * l * 0.5 + Math.cos(along) * 3,
        cy: by + Math.sin(ang) * l * 0.5 + Math.sin(along) * 3,
        x1: bx + Math.cos(ang) * l,
        y1: by + Math.sin(ang) * l,
      },
      width: 1,
      delay: grow * easeInOutInverse(at),
      grow: 0.14,
      hold: 0.25,
      fade: 0.3,
      age: 0,
      tip: 1.2,
    });
  }

  return new Promise((resolve) => {
    alive.push({
      kind: 'hypha',
      q,
      width: 1.4,
      delay: 0,
      grow,
      hold: 0.25,
      fade: 0.35,
      age: 0,
      tip: 0,
      onTip: () => {
        germinate(x1, y1, { size: 14, spores: true, hold: 0.15 });
        resolve();
      },
    });
    start();
  });
}

/** Rough inverse of the hypha growth easing, to time buds to the tip. */
function easeInOutInverse(p: number): number {
  // easeOut(g) = p  →  g = 1 - (1 - p)^(1/3)
  return 1 - Math.cbrt(1 - p);
}

/**
 * The vault opens: one large spore germinates in the middle of the window
 * and sheds a cloud of spores while the workspace grows in behind it.
 */
export function awaken() {
  const size = Math.min(window.innerWidth, window.innerHeight) * 0.26;
  germinate(window.innerWidth / 2, window.innerHeight / 2, {
    size,
    spores: true,
    hold: 0.1,
  });
  if (!sporeMotionEnabled()) return;
  for (let i = 0; i < 18; i++) {
    const a = Math.random() * Math.PI * 2;
    const r = Math.random() * size * 0.6;
    release(
      window.innerWidth / 2 + Math.cos(a) * r,
      window.innerHeight / 2 + Math.sin(a) * r,
      1.6,
      60,
    );
  }
}

/**
 * Wait for a tree row with this path to be in the DOM, then let it sprout.
 * The tree re-renders after an async refresh, so poll a few frames.
 */
export function sproutRow(path: string) {
  if (!sporeMotionEnabled()) return;
  let tries = 0;
  const find = () => {
    const row = document.querySelector<HTMLElement>(
      `[data-tree-path="${CSS.escape(path)}"]`,
    );
    if (row) {
      row.classList.remove('myc-sprouted');
      // Restart the CSS animation if the class was already there.
      void row.offsetWidth;
      row.classList.add('myc-sprouted');
      row.addEventListener('animationend', () => row.classList.remove('myc-sprouted'), {
        once: true,
      });
      germinateAt(row, { size: 18 });
      return;
    }
    if (++tries < 30) requestAnimationFrame(find);
  };
  requestAnimationFrame(find);
}

// ── Helpers ─────────────────────────────────────────────────────────────

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
