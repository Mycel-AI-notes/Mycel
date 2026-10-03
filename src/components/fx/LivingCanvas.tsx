import { useEffect, useRef } from 'react';
import { clsx } from 'clsx';
import { bubbleBurst, sporeAirHeld } from '@/lib/spore-fx';

/**
 * The living canvas — the app icon's glassy mycelium, grown around the
 * edges of the vault picker and the empty workspace.
 *
 *   - translucent droplets joined by tapering hyphae; a smooth union webs
 *     them together where they meet, like the icon's joints;
 *   - each body is lit like glass: a glowing inner rim, a darker see-through
 *     core, a soft highlight from the upper left and a halo around it;
 *   - silky veils sweep slowly behind them;
 *   - one closed ring of mycelium frames the room, with a couple of
 *     hyphae reaching inward;
 *   - small bubbles rise along the sides and fuse into whatever they pass;
 *   - bodies drift and breathe, lean toward the pointer, and the pointer
 *     carries a droplet that fuses into whatever it touches; a click makes
 *     the nearest body shoot a hypha to it, which pulls back and lets a
 *     puff of bubbles go.
 *
 * Drawn by one fragment shader. Every colour comes from the theme tokens
 * (`--color-accent*`, `--color-living`), re-read whenever the palette or mode changes, so it
 * follows every theme. With motion off it renders one still frame. If
 * WebGL is unavailable it simply draws nothing.
 */

interface Body {
  /** home position, 0..1 of the host */
  u: number;
  v: number;
  /** radius as a fraction of min(width, height) */
  r: number;
  phase: number;
  /** drift amplitude, fraction of min(width, height) */
  drift: number;
}

const BODIES: Body[] = [
  /* 0 */ { u: 0.05, v: 0.22, r: 0.075, phase: 0.0, drift: 0.014 },
  /* 1 */ { u: 0.22, v: 0.04, r: 0.045, phase: 1.3, drift: 0.012 },
  /* 2 */ { u: 0.95, v: 0.16, r: 0.07, phase: 2.1, drift: 0.016 },
  /* 3 */ { u: 0.78, v: 0.05, r: 0.04, phase: 3.4, drift: 0.012 },
  /* 4 */ { u: 0.97, v: 0.66, r: 0.085, phase: 4.2, drift: 0.016 },
  /* 5 */ { u: 0.83, v: 0.94, r: 0.055, phase: 5.0, drift: 0.014 },
  /* 6 */ { u: 0.07, v: 0.86, r: 0.08, phase: 0.7, drift: 0.014 },
  /* 7 */ { u: 0.3, v: 0.97, r: 0.04, phase: 2.6, drift: 0.012 },
  /* 8 */ { u: 0.02, v: 0.55, r: 0.04, phase: 3.9, drift: 0.012 },
  // knots that close the ring across the top and bottom edges
  /* 9 */ { u: 0.5, v: 0.02, r: 0.024, phase: 0.4, drift: 0.01 },
  /* 10 */ { u: 0.56, v: 0.985, r: 0.026, phase: 2.9, drift: 0.01 },
  // drops at the end of the inward hyphae
  /* 11 */ { u: 0.84, v: 0.33, r: 0.02, phase: 4.6, drift: 0.02 },
  /* 12 */ { u: 0.17, v: 0.71, r: 0.022, phase: 5.5, drift: 0.02 },
];

/** Hyphae between bodies: [from, to, bow]. One closed ring plus two spurs. */
const NECKS: ReadonlyArray<[number, number, number]> = [
  [0, 1, 0.12],
  [1, 9, -0.08],
  [9, 3, 0.08],
  [3, 2, -0.12],
  [2, 4, 0.1],
  [4, 5, -0.1],
  [5, 10, 0.08],
  [10, 7, -0.08],
  [7, 6, -0.12],
  [6, 8, 0.1],
  [8, 0, -0.1],
  [2, 11, 0.16],
  [6, 12, -0.16],
];
/** Each hypha is a quadratic split into this many tapered capsules. */
const NECK_SEGS = 5;

/** Bubbles rising along the sides: [x (0..1), size, speed, offset]. */
const BUBBLES: ReadonlyArray<[number, number, number, number]> = [
  [0.04, 0.011, 0.03, 0.1],
  [0.12, 0.007, 0.045, 0.55],
  [0.2, 0.009, 0.035, 0.3],
  [0.26, 0.006, 0.05, 0.8],
  [0.09, 0.013, 0.025, 0.7],
  [0.74, 0.008, 0.04, 0.2],
  [0.8, 0.012, 0.028, 0.65],
  [0.88, 0.007, 0.05, 0.4],
  [0.93, 0.01, 0.033, 0.9],
  [0.97, 0.006, 0.045, 0.05],
];

/** A click's hypha: grows out to the point, then pulls back. Seconds. */
const PULL_TIME = 1.2;
const PULL_REACH = 0.42;

const MAX_BALLS = 32;
const MAX_SEGS = 80;
const FPS = 30;

const VERT = `
attribute vec2 aPos;
void main() { gl_Position = vec4(aPos, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;

uniform vec2 uRes;        // canvas size, device px
uniform float uScale;     // device px per CSS px
uniform float uM;         // min(w, h) in CSS px
uniform float uTime;
uniform float uLight;     // 1 on light palettes
uniform vec3 uBright;
uniform vec3 uBody;
uniform vec3 uDeep;
uniform vec3 uLiving;     // the glass's inner tint
uniform int uBallN;
uniform vec3 uBall[${MAX_BALLS}];   // x, y, r
uniform int uSegN;
uniform vec4 uSegA[${MAX_SEGS}];    // ax, ay, ra, 1 = first of a hypha
uniform vec4 uSegB[${MAX_SEGS}];    // bx, by, rb, -
uniform vec3 uTip;                  // x, y, r (r = 0 when away)

float smin(float a, float b, float k) {
  float h = max(k - abs(a - b), 0.0) / k;
  return min(a, b) - h * h * k * 0.25;
}

float capsule(vec2 p, vec2 a, vec2 b, float ra, float rb) {
  vec2 pa = p - a;
  vec2 ba = b - a;
  float t = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-4), 0.0, 1.0);
  return length(pa - ba * t) - mix(ra, rb, t);
}

float scene(vec2 p) {
  float k = uM * 0.05;
  float d = 1e5;
  for (int i = 0; i < ${MAX_BALLS}; i++) {
    if (i >= uBallN) break;
    d = smin(d, length(p - uBall[i].xy) - uBall[i].z, k);
  }
  // A hypha's own capsules join with a hard min (a soft one would bulge
  // at every joint); the whole hypha then webs into the bodies.
  float h = 1e5;
  for (int i = 0; i < ${MAX_SEGS}; i++) {
    if (i >= uSegN) break;
    if (uSegA[i].w > 0.5 && i > 0) {
      d = smin(d, h, k * 0.8);
      h = 1e5;
    }
    h = min(h, capsule(p, uSegA[i].xy, uSegB[i].xy, uSegA[i].z, uSegB[i].z));
  }
  d = smin(d, h, k * 0.8);
  if (uTip.z > 0.5) d = smin(d, length(p - uTip.xy) - uTip.z, uM * 0.09);
  return d;
}

// Silky veils: soft sheets under slow sine curves, with a bright lip.
vec4 veils(vec2 p) {
  vec2 q = p / uM;
  float hh = uRes.y / uScale / uM;
  vec4 acc = vec4(0.0);
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float y = (0.25 + fi * 0.3) * hh
      + 0.12 * sin(q.x * (1.6 + fi * 0.7) + uTime * (0.05 + fi * 0.02) + fi * 2.1)
      + 0.05 * sin(q.x * (3.1 - fi) - uTime * 0.04 + fi);
    float dist = q.y - y;
    float sheet = smoothstep(0.0, 0.35, dist) * exp(-dist * 1.6) * 0.06;
    float lip = exp(-abs(dist) * 260.0) * 0.07 + exp(-abs(dist) * 40.0) * 0.03;
    float a = (sheet + lip) * (0.7 - fi * 0.15);
    vec3 c = mix(uDeep, uBody, clamp(lip * 3.0, 0.0, 1.0));
    acc.rgb = acc.rgb * (1.0 - a) + c * a;
    acc.a = acc.a * (1.0 - a) + a;
  }
  return acc;
}

void main() {
  vec2 p = vec2(gl_FragCoord.x, uRes.y - gl_FragCoord.y) / uScale;

  float d = scene(p);
  // A wide difference step smooths the creases where capsules overlap.
  float e = 2.5;
  vec2 grad = normalize(vec2(
    scene(p + vec2(e, 0.0)) - d,
    scene(p + vec2(0.0, e)) - d
  ) + 1e-6);

  float strength = mix(1.0, 0.6, uLight);

  // Back to front: veils, halo, glass body.
  vec4 col = veils(p);

  float halo = exp(-max(d, 0.0) / (uM * 0.03)) * 0.5 * step(0.0, d);
  vec3 haloC = mix(uLiving, uBody, 0.5);
  col.rgb = col.rgb * (1.0 - halo) + haloC * halo;
  col.a = col.a * (1.0 - halo) + halo;

  float inside = smoothstep(0.9, -0.9, d);
  if (inside > 0.0) {
    // Height falls off toward the rim like a lens; the SDF gradient gives
    // the rim's outward direction.
    float s = clamp(-d / (uM * 0.05), 0.0, 1.0);
    float nz = sqrt(s * (2.0 - s));
    vec3 n = normalize(vec3(grad * sqrt(max(1.0 - nz * nz, 0.0)), nz + 1e-3));
    vec3 l = normalize(vec3(-0.55, -0.7, 0.75));
    float diff = max(dot(n, l), 0.0);
    vec3 r = reflect(-l, n);
    float spec = pow(max(r.z, 0.0), 48.0);
    float fres = pow(1.0 - n.z, 2.0);
    float innerRim = exp(d / (uM * 0.016));
    // Light gathering in the lower body, as in a lit drop of liquid.
    float sss = pow(max(dot(n.xy, vec2(0.45, 0.8)), 0.0), 1.5) * (1.0 - innerRim);

    // A see-through core: the room shows through, the rim does the glowing.
    vec3 core = mix(uLiving, uBody, 0.1 + 0.28 * diff);
    vec3 glass = core
      + uBright * (0.85 * innerRim + 0.3 * fres + 0.35 * sss)
      + vec3(1.0) * spec * 0.6;
    float ga = 0.2 + 0.18 * diff + 0.62 * max(innerRim, fres) + 0.25 * sss + spec * 0.4;
    ga = clamp(ga, 0.0, 1.0) * inside;
    col.rgb = col.rgb * (1.0 - ga) + min(glass, vec3(1.0)) * ga;
    col.a = col.a * (1.0 - ga) + ga;
  }

  col *= strength;
  gl_FragColor = col; // premultiplied
}
`;

type Rgb = [number, number, number];

function parseColor(value: string, fallback: Rgb): Rgb {
  const v = value.trim();
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(v);
  if (hex) {
    let h = hex[1];
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const n = parseInt(h, 16);
    return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
  }
  const rgb = /rgba?\(([^)]+)\)/i.exec(v);
  if (rgb) {
    const [r, g, b] = rgb[1].split(',').map((p) => parseFloat(p) / 255);
    if ([r, g, b].every(Number.isFinite)) return [r, g, b];
  }
  return fallback;
}

function readPalette() {
  const css = getComputedStyle(document.documentElement);
  const read = (name: string, fallback: Rgb) => parseColor(css.getPropertyValue(name), fallback);
  // Light palettes paint the canvas into a near-white room: thinner there,
  // so the glass tints rather than shouts.
  const surface = read('--color-surface-1', [0.04, 0.05, 0.05]);
  return {
    light: (surface[0] + surface[1] + surface[2]) / 3 > 0.5,
    bright: read('--color-accent-bright', [0.84, 1, 0.25]),
    body: read('--color-accent', [0.78, 0.96, 0.16]),
    deep: read('--color-accent-deep', [0.36, 0.44, 0.07]),
    living: read('--color-living', [0.18, 0.48, 0.13]),
  };
}

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const sh = gl.createShader(type);
  if (!sh) return null;
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    console.warn('LivingCanvas shader:', gl.getShaderInfoLog(sh));
    return null;
  }
  return sh;
}

interface Props {
  className?: string;
  /** Freeze into one still frame (Settings → Spore motion off). */
  still?: boolean;
}

export function LivingCanvas({ className, still = false }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    const gl = canvas?.getContext('webgl', { premultipliedAlpha: true, antialias: false });
    if (!canvas || !host || !gl) return;

    const vs = compile(gl, gl.VERTEX_SHADER, VERT);
    const fs = compile(gl, gl.FRAGMENT_SHADER, FRAG);
    const prog = gl.createProgram();
    if (!vs || !fs || !prog) return;
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.warn('LivingCanvas link:', gl.getProgramInfoLog(prog));
      return;
    }
    gl.useProgram(prog);

    // One oversized triangle covers the viewport.
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    const aPos = gl.getAttribLocation(prog, 'aPos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    const U = (name: string) => gl.getUniformLocation(prog, name);
    const u = {
      res: U('uRes'),
      scale: U('uScale'),
      m: U('uM'),
      time: U('uTime'),
      light: U('uLight'),
      bright: U('uBright'),
      body: U('uBody'),
      deep: U('uDeep'),
      living: U('uLiving'),
      ballN: U('uBallN'),
      ball: U('uBall'),
      segN: U('uSegN'),
      segA: U('uSegA'),
      segB: U('uSegB'),
      tip: U('uTip'),
    };

    const balls = new Float32Array(MAX_BALLS * 3);
    const segA = new Float32Array(MAX_SEGS * 4);
    const segB = new Float32Array(MAX_SEGS * 4);

    let w = 1;
    let h = 1;
    let scale = 1;
    let raf = 0;
    let lastDraw = 0;
    let last = performance.now();
    let clock = still ? 8 : 0;

    const tip = { x: 0, y: 0, sx: 0, sy: 0, inside: 0, target: 0 };
    /** The click's hypha: which body, where to, how far along (0..1). */
    let pull: { body: number; x: number; y: number; cx: number; cy: number; t: number; puffed: boolean } | null =
      null;

    const applyPalette = () => {
      const pal = readPalette();
      gl.uniform3fv(u.bright, pal.bright);
      gl.uniform3fv(u.body, pal.body);
      gl.uniform3fv(u.deep, pal.deep);
      gl.uniform3fv(u.living, pal.living);
      gl.uniform1f(u.light, pal.light ? 1 : 0);
    };
    applyPalette();

    const layout = (t: number) => {
      const m = Math.min(w, h);
      const pos: [number, number, number][] = [];
      let n = 0;
      for (const b of BODIES) {
        let x = b.u * w + Math.sin(t * 0.21 + b.phase) * b.drift * m;
        let y = b.v * h + Math.cos(t * 0.17 + b.phase * 1.3) * b.drift * m;
        let r = b.r * m * (1 + Math.sin(t * 0.5 + b.phase) * 0.05);
        // Lean toward the pointer.
        if (tip.inside > 0.01) {
          const dx = tip.sx - x;
          const dy = tip.sy - y;
          const reach = m * 0.4;
          const k = Math.exp(-(dx * dx + dy * dy) / (reach * reach)) * tip.inside;
          x += dx * k * 0.14;
          y += dy * k * 0.14;
          r *= 1 + k * 0.1;
        }
        pos.push([x, y, r]);
        balls.set([x, y, r], n * 3);
        n++;
      }

      // Rising bubbles; they fuse into bodies and hyphae as they pass.
      for (const [bu, bs, speed, off] of BUBBLES) {
        const r = bs * m;
        const span = h + r * 4;
        const y = h + r * 2 - ((t * speed * m + off * span) % span);
        const x = bu * w + Math.sin(t * 0.9 + off * 9) * m * 0.012;
        balls.set([x, y, r], n * 3);
        n++;
      }

      // Hyphae: a swaying quadratic, thick where it leaves a body and
      // thinnest in the middle.
      let sn = 0;
      for (const [a, c, bow] of NECKS) {
        const [ax, ay, ar] = pos[a];
        const [cx, cy, cr] = pos[c];
        const dx = cx - ax;
        const dy = cy - ay;
        const len = Math.hypot(dx, dy) || 1;
        const sway = bow + Math.sin(t * 0.3 + a + c) * 0.03;
        const qx = (ax + cx) / 2 + (-dy / len) * sway * len;
        const qy = (ay + cy) / 2 + (dx / len) * sway * len;
        const neck = m * 0.007 * (1 + Math.sin(t * 0.6 + a) * 0.2);
        const at = (s: number): [number, number, number] => {
          const o = 1 - s;
          const flare = Math.pow(Math.abs(s - 0.5) * 2, 2.5);
          return [
            o * o * ax + 2 * o * s * qx + s * s * cx,
            o * o * ay + 2 * o * s * qy + s * s * cy,
            neck + flare * (s < 0.5 ? ar : cr) * 0.45,
          ];
        };
        for (let i = 0; i < NECK_SEGS; i++) {
          const p0 = at(i / NECK_SEGS);
          const p1 = at((i + 1) / NECK_SEGS);
          segA.set([p0[0], p0[1], p0[2], i === 0 ? 1 : 0], sn * 4);
          segB.set([p1[0], p1[1], p1[2], 0], sn * 4);
          sn++;
        }
      }
      // The click's hypha: out to the point, then back into its body.
      if (pull) {
        const [ax, ay, ar] = pos[pull.body];
        const k = pull.t < 0.38
          ? 1 - Math.pow(1 - pull.t / 0.38, 3)
          : 1 - Math.pow((pull.t - 0.38) / 0.62, 2) * (3 - 2 * ((pull.t - 0.38) / 0.62));
        const ex = ax + (pull.x - ax) * k;
        const ey = ay + (pull.y - ay) * k;
        const dx = ex - ax;
        const dy = ey - ay;
        const len = Math.hypot(dx, dy) || 1;
        const qx = (ax + ex) / 2 + (-dy / len) * len * 0.12;
        const qy = (ay + ey) / 2 + (dx / len) * len * 0.12;
        const at = (s: number): [number, number, number] => {
          const o = 1 - s;
          return [
            o * o * ax + 2 * o * s * qx + s * s * ex,
            o * o * ay + 2 * o * s * qy + s * s * ey,
            m * 0.005 + Math.pow(1 - s, 3) * ar * 0.5,
          ];
        };
        for (let i = 0; i < NECK_SEGS; i++) {
          const p0 = at(i / NECK_SEGS);
          const p1 = at((i + 1) / NECK_SEGS);
          segA.set([p0[0], p0[1], p0[2], i === 0 ? 1 : 0], sn * 4);
          segB.set([p1[0], p1[1], p1[2], 0], sn * 4);
          sn++;
        }
        balls.set([ex, ey, m * 0.016 * Math.min(1, k * 3)], n * 3);
        n++;
      }
      return { n, sn, m };
    };

    const draw = () => {
      const { n, sn, m } = layout(clock);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(u.res, canvas.width, canvas.height);
      gl.uniform1f(u.scale, scale);
      gl.uniform1f(u.m, m);
      gl.uniform1f(u.time, clock);
      gl.uniform1i(u.ballN, n);
      gl.uniform3fv(u.ball, balls);
      gl.uniform1i(u.segN, sn);
      gl.uniform4fv(u.segA, segA);
      gl.uniform4fv(u.segB, segB);
      gl.uniform3f(u.tip, tip.sx, tip.sy, tip.inside > 0.01 ? m * 0.018 * tip.inside : 0);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    };

    const resize = () => {
      const r = host.getBoundingClientRect();
      w = Math.max(1, r.width);
      h = Math.max(1, r.height);
      // The glass is soft by nature: cap the resolution to keep it cheap.
      scale = Math.min(window.devicePixelRatio || 1, 1.25);
      canvas.width = Math.round(w * scale);
      canvas.height = Math.round(h * scale);
      if (!tip.inside) {
        tip.sx = tip.x = w / 2;
        tip.sy = tip.y = h / 2;
      }
      draw();
    };

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden || sporeAirHeld()) {
        last = now;
        return;
      }
      if (now - lastDraw < 1000 / FPS) return;
      lastDraw = now;
      const dt = Math.max(0, Math.min((now - last) / 1000, 1 / 10));
      last = now;
      clock += dt;
      tip.sx += (tip.x - tip.sx) * Math.min(1, dt * 5);
      tip.sy += (tip.y - tip.sy) * Math.min(1, dt * 5);
      tip.inside += (tip.target - tip.inside) * Math.min(1, dt * 3);
      if (pull) {
        pull.t += dt / PULL_TIME;
        // At full stretch the tip lets a puff of bubbles go.
        if (!pull.puffed && pull.t >= 0.38) {
          pull.puffed = true;
          bubbleBurst(pull.cx, pull.cy, { size: 5, count: 6 });
        }
        if (pull.t >= 1) pull = null;
      }
      draw();
    };

    const local = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      return { x: e.clientX - r.left, y: e.clientY - r.top };
    };
    const onMove = (e: PointerEvent) => {
      const p = local(e);
      tip.x = p.x;
      tip.y = p.y;
      tip.target = 1;
    };
    const onLeave = () => {
      tip.target = 0;
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const p = local(e);
      const m = Math.min(w, h);
      // The body whose surface is nearest reaches for the click.
      const t = clock;
      let best = -1;
      let bestD = Infinity;
      BODIES.forEach((b, i) => {
        const bx = b.u * w + Math.sin(t * 0.21 + b.phase) * b.drift * m;
        const by = b.v * h + Math.cos(t * 0.17 + b.phase * 1.3) * b.drift * m;
        const d = Math.hypot(p.x - bx, p.y - by) - b.r * m;
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      });
      if (best < 0) return;
      // Out of reach: the hypha stretches as far as it can toward it.
      const b = BODIES[best];
      const bx = b.u * w;
      const by = b.v * h;
      const dist = Math.hypot(p.x - bx, p.y - by) || 1;
      const reach = Math.min(1, (PULL_REACH * m) / dist);
      pull = {
        body: best,
        x: bx + (p.x - bx) * reach,
        y: by + (p.y - by) * reach,
        cx: e.clientX - (p.x - (bx + (p.x - bx) * reach)),
        cy: e.clientY - (p.y - (by + (p.y - by) * reach)),
        t: 0,
        puffed: false,
      };
    };

    // Palette or mode switched: re-read the tokens and repaint.
    const mo = new MutationObserver(() => {
      applyPalette();
      draw();
    });
    mo.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-palette'],
    });

    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    if (!still) {
      host.addEventListener('pointermove', onMove);
      host.addEventListener('pointerleave', onLeave);
      host.addEventListener('pointerdown', onDown);
      raf = requestAnimationFrame(tick);
    }

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      mo.disconnect();
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
      host.removeEventListener('pointerdown', onDown);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
      gl.deleteBuffer(buf);
    };
  }, [still]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className={clsx('absolute inset-0 w-full h-full pointer-events-none myc-fade-in', className)}
    />
  );
}
