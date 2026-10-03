import { useUIStore } from '@/stores/ui';

/**
 * Living FX — glassy bubbles of the same living matter the canvas draws,
 * played out on one full-window overlay:
 *
 *   burst  → a cluster of bubbles buds off a point, rises on a wobble and
 *            pops (a new note or folder, a click on the canvas)
 *   gather → bubbles drift in from a ring and pull together into one
 *            point, which pops (a vault opening, a row being born)
 *
 * Rules, so none of it gets in the way of writing:
 *   - the canvas never takes pointer events;
 *   - the RAF loop runs only while something is alive, then stops;
 *   - every effect is gone in about a second and a half;
 *   - it is all a no-op when "Spore motion" is off or the OS asks for
 *     reduced motion.
 */

// ── Gating ──────────────────────────────────────────────────────────────

/**
 * Full-screen overlays (the graph) cover the living canvas completely; it
 * should not keep drawing frames nobody can see while the overlay needs
 * them. Each holder calls `holdSporeAir()` and the returned release.
 */
let airHolds = 0;
export function holdSporeAir(): () => void {
  airHolds++;
  let released = false;
  return () => {
    if (released) return;
    released = true;
    airHolds--;
  };
}
export function sporeAirHeld(): boolean {
  return airHolds > 0;
}

const reducedMotion =
  typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null;

export function sporeMotionEnabled(): boolean {
  if (reducedMotion?.matches) return false;
  return useUIStore.getState().features.sporeMotion !== false;
}

/** `#rgb` / `#rrggbb` → `rgba(…, a)`; anything else passes through opaque. */
function withAlpha(color: string, a: number): string {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (!m) return color;
  let h = m[1];
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

/** Live accent colours, so palette and theme switches just work. */
function livePalette() {
  const css = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: string) => css.getPropertyValue(name).trim() || fallback;
  return {
    dark: document.documentElement.classList.contains('dark'),
    rim: read('--color-accent-bright', '#97B91E'),
    body: read('--color-accent', '#5C7012'),
  };
}

// ── Bubbles ─────────────────────────────────────────────────────────────

interface Bubble {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  /** wobble phase */
  phase: number;
  age: number;
  ttl: number;
  /** seconds before it appears */
  delay: number;
  /** gather bubbles home in on this point */
  to?: { x: number; y: number };
}

interface Pop {
  x: number;
  y: number;
  r: number;
  age: number;
  ttl: number;
  delay: number;
}

let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let bubbles: Bubble[] = [];
let pops: Pop[] = [];
let raf = 0;
let last = 0;
let dpr = 1;
let pal: ReturnType<typeof livePalette> | null = null;

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
  pal = livePalette();
  if (raf) return;
  last = performance.now();
  raf = requestAnimationFrame(tick);
}

const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);
/** Small overshoot — bubbles "bud" into being. */
const easeBack = (t: number) => {
  const k = 1.7;
  return 1 + (k + 1) * Math.pow(t - 1, 3) + k * Math.pow(t - 1, 2);
};

/** One glass bubble: see-through body, glowing rim, a glint up-left. */
function drawBubble(c: CanvasRenderingContext2D, x: number, y: number, r: number, alpha: number) {
  if (r <= 0.3 || alpha <= 0 || !pal) return;
  c.globalAlpha = alpha;

  const body = c.createRadialGradient(x - r * 0.25, y - r * 0.3, r * 0.1, x, y, r);
  body.addColorStop(0, withAlpha(pal.body, 0));
  body.addColorStop(0.7, withAlpha(pal.body, 0.14));
  body.addColorStop(1, withAlpha(pal.rim, 0.45));
  c.fillStyle = body;
  c.beginPath();
  c.arc(x, y, r, 0, Math.PI * 2);
  c.fill();

  c.shadowColor = pal.rim;
  c.shadowBlur = Math.min(14, r * 1.4);
  c.strokeStyle = pal.rim;
  c.lineWidth = Math.max(0.8, r * 0.09);
  c.stroke();
  c.shadowBlur = 0;

  if (r > 3) {
    c.strokeStyle = pal.dark ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.95)';
    c.lineWidth = Math.max(0.8, r * 0.1);
    c.lineCap = 'round';
    c.beginPath();
    c.arc(x, y, r * 0.66, Math.PI * 1.08, Math.PI * 1.38);
    c.stroke();
  }
  c.globalAlpha = 1;
}

function tick(now: number) {
  const c = ctx;
  if (!c || !canvas) return;
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;

  c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.clearRect(0, 0, window.innerWidth, window.innerHeight);

  for (const b of bubbles) {
    if (b.delay > 0) {
      b.delay -= dt;
      continue;
    }
    b.age += dt;
    const t = Math.min(1, b.age / b.ttl);
    if (b.to) {
      // Gather: ease toward the point, shrinking as it is absorbed.
      const k = Math.min(1, dt * (3 + t * 6));
      b.x += (b.to.x - b.x) * k;
      b.y += (b.to.y - b.y) * k;
    } else {
      b.vy -= 18 * dt; // buoyancy
      b.vx *= 1 - dt * 1.5;
      b.x += (b.vx + Math.sin(b.age * 6 + b.phase) * 10) * dt;
      b.y += b.vy * dt;
    }
    const grow = easeBack(Math.min(1, b.age / 0.22));
    const shrink = b.to ? 1 - easeOut(t) * 0.85 : 1;
    const fade = b.to ? 1 : 1 - Math.max(0, (t - 0.7) / 0.3);
    drawBubble(c, b.x, b.y, b.r * grow * shrink, fade);
    if (!b.to && t >= 1) pops.push({ x: b.x, y: b.y, r: b.r, age: 0, ttl: 0.3, delay: 0 });
  }
  bubbles = bubbles.filter((b) => b.age < b.ttl);

  for (const p of pops) {
    if (p.delay > 0) {
      p.delay -= dt;
      continue;
    }
    p.age += dt;
    const t = Math.min(1, p.age / p.ttl);
    if (!pal) continue;
    c.globalAlpha = (1 - t) * 0.8;
    c.strokeStyle = pal.rim;
    c.lineWidth = 1;
    c.beginPath();
    c.arc(p.x, p.y, p.r * (1 + easeOut(t) * 1.4), 0, Math.PI * 2);
    c.stroke();
    c.globalAlpha = 1;
  }
  pops = pops.filter((p) => p.age < p.ttl);

  if (bubbles.length || pops.length) {
    raf = requestAnimationFrame(tick);
  } else {
    raf = 0;
    c.clearRect(0, 0, window.innerWidth, window.innerHeight);
  }
}

export interface BubbleOptions {
  /** typical bubble radius, px */
  size?: number;
  /** how many bubbles */
  count?: number;
}

/** Bubbles bud off a point, rise on a wobble and pop. */
export function bubbleBurst(x: number, y: number, opts: BubbleOptions = {}) {
  if (!sporeMotionEnabled() || !ensureCanvas()) return;
  const size = opts.size ?? 6;
  const count = opts.count ?? 7;
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.4;
    const speed = 20 + Math.random() * 45;
    bubbles.push({
      x: x + (Math.random() - 0.5) * size,
      y: y + (Math.random() - 0.5) * size,
      vx: Math.cos(a) * speed,
      vy: Math.sin(a) * speed,
      r: size * (0.45 + Math.random() * 0.8),
      phase: Math.random() * Math.PI * 2,
      age: 0,
      ttl: 0.9 + Math.random() * 0.7,
      delay: i * 0.035,
    });
  }
  start();
}

/** Bubbles drift in from a ring, pull together into one point and pop. */
export function bubbleGather(x: number, y: number, opts: BubbleOptions & { radius?: number } = {}) {
  if (!sporeMotionEnabled() || !ensureCanvas()) return;
  const size = opts.size ?? 5;
  const count = opts.count ?? 9;
  const radius = opts.radius ?? 60;
  const ttl = 0.6;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + Math.random() * 0.5;
    const d = radius * (0.75 + Math.random() * 0.5);
    bubbles.push({
      x: x + Math.cos(a) * d,
      y: y + Math.sin(a) * d,
      vx: 0,
      vy: 0,
      r: size * (0.6 + Math.random() * 0.7),
      phase: 0,
      age: 0,
      ttl,
      delay: Math.random() * 0.12,
      to: { x, y },
    });
  }
  pops.push({ x, y, r: size * 1.6, age: 0, ttl: 0.45, delay: ttl + 0.05 });
  start();
}

/** Bubble out of an element's entry icon (or the element itself). */
export function bubbleAt(el: Element, opts?: BubbleOptions) {
  const { x, y } = centerOf(iconOf(el));
  bubbleBurst(x, y, opts);
}

/**
 * The vault opens: living matter gathers in the middle of the window,
 * then a cloud of bubbles rises off it while the workspace fades in.
 */
export function awaken() {
  const cx = window.innerWidth / 2;
  const cy = window.innerHeight / 2;
  const m = Math.min(window.innerWidth, window.innerHeight);
  bubbleGather(cx, cy, { radius: m * 0.22, size: 9, count: 14 });
  window.setTimeout(() => bubbleBurst(cx, cy, { size: 8, count: 12 }), 620);
}

/**
 * Wait for a tree row with this path to be in the DOM, then let it bud.
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
      bubbleAt(row, { size: 4, count: 5 });
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
