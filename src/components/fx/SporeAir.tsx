import { useEffect, useRef } from 'react';
import { drawSpore, germinate, sporeAirHeld, sporePalette } from '@/lib/spore-fx';

/**
 * Spores on the air, behind the empty editor and the vault picker.
 *
 *   - spores at three depths rise slowly on a lazy wobble, breathing in
 *     and out of brightness, and parallax against the pointer;
 *   - the pointer is a growing hyphal tip: spores near it lean in and get
 *     threaded to it — and to each other — by curved, swaying hyphae, so
 *     you literally draw mycelium as you move;
 *   - a click germinates a spore into the Mycel mark and puffs the
 *     surrounding air outward;
 *   - every so often one of the floating spores germinates on its own.
 *
 * It listens on its parent element so content layered on top (the logo,
 * the buttons) does not block the pointer.
 */

interface Spore {
  x: number;
  y: number;
  /** depth 0.25..1 — nearer spores are bigger, brighter and move more */
  z: number;
  phase: number;
  breath: number;
  /** horizontal wobble amplitude */
  sway: number;
}

interface Puff {
  x: number;
  y: number;
  t: number;
}

const THREAD_RADIUS = 140;
const NEIGHBOUR_RADIUS = 72;
const PUFF_LIFE = 1.4;

export function SporeAir() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !host || !ctx) return;

    let w = 0;
    let h = 0;
    let dpr = 1;
    let spores: Spore[] = [];
    const puffs: Puff[] = [];
    let nextSprout = 5 + Math.random() * 5;
    let pal = sporePalette();
    let frame = 0;
    let raf = 0;
    let last = performance.now();

    // Pointer, raw and smoothed. `inside` fades the threads in and out.
    const tip = { x: 0, y: 0, sx: 0, sy: 0, inside: 0, target: 0 };

    const seed = () => {
      const count = Math.min(170, Math.round((w * h) / 6200));
      spores = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        z: 0.25 + Math.pow(Math.random(), 2) * 0.75,
        phase: Math.random() * Math.PI * 2,
        breath: 0.4 + Math.random() * 0.9,
        sway: 4 + Math.random() * 10,
      }));
    };

    const resize = () => {
      const r = host.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      const grew = r.width > w * 1.2 || r.height > h * 1.2;
      w = r.width;
      h = r.height;
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      if (grew || !spores.length) seed();
      tip.sx = tip.x = w / 2;
      tip.sy = tip.y = h / 2;
    };

    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    const onMove = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      tip.x = e.clientX - r.left;
      tip.y = e.clientY - r.top;
      tip.target = 1;
    };
    const onLeave = () => {
      tip.target = 0;
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const r = host.getBoundingClientRect();
      puffs.push({ x: e.clientX - r.left, y: e.clientY - r.top, t: 0 });
      germinate(e.clientX, e.clientY, { size: 34 });
    };
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);
    host.addEventListener('pointerdown', onDown);

    // Position of a spore this frame (drift + parallax + puffs + pull),
    // plus how strongly the hyphal tip has it (0..1).
    const place = (s: Spore, time: number, ox: number, oy: number) => {
      let x = s.x + Math.sin(time * 0.5 + s.phase) * s.sway - ox * 26 * s.z;
      let y = s.y - oy * 18 * s.z;

      for (const p of puffs) {
        const dx = x - p.x;
        const dy = y - p.y;
        const d = Math.hypot(dx, dy) || 1;
        const front = 40 + p.t * 260;
        const band = Math.exp(-Math.pow((d - front) / 50, 2));
        const push = band * 30 * (1 - p.t / PUFF_LIFE) * s.z;
        x += (dx / d) * push;
        y += (dy / d) * push;
      }

      let k = 0;
      const mdx = tip.sx - x;
      const mdy = tip.sy - y;
      const md = Math.hypot(mdx, mdy);
      if (md < THREAD_RADIUS && tip.inside > 0.01) {
        k = (1 - md / THREAD_RADIUS) * tip.inside;
        const pull = k * k * 12 * s.z;
        x += (mdx / (md || 1)) * pull;
        y += (mdy / (md || 1)) * pull;
      }
      return { x, y, k };
    };

    // A hypha between two points: a quadratic that bows sideways and sways.
    const thread = (
      ax: number,
      ay: number,
      bx: number,
      by: number,
      seedPhase: number,
      time: number,
    ) => {
      const mx = (ax + bx) / 2;
      const my = (ay + by) / 2;
      const dx = bx - ax;
      const dy = by - ay;
      const len = Math.hypot(dx, dy) || 1;
      const bow = Math.sin(time * 1.3 + seedPhase) * 0.18 * len;
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.quadraticCurveTo(mx + (-dy / len) * bow, my + (dx / len) * bow, bx, by);
      ctx.stroke();
    };

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      // Nothing to draw while the window is hidden or an overlay covers us.
      if (document.hidden || sporeAirHeld()) {
        last = now;
        return;
      }
      const dt = Math.max(0, Math.min((now - last) / 1000, 1 / 20));
      last = now;
      const time = now / 1000;
      if (++frame % 45 === 0) pal = sporePalette();

      tip.sx += (tip.x - tip.sx) * Math.min(1, dt * 6);
      tip.sy += (tip.y - tip.sy) * Math.min(1, dt * 6);
      tip.inside += (tip.target - tip.inside) * Math.min(1, dt * 4);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = pal.dark ? 'lighter' : 'source-over';
      ctx.lineCap = 'round';

      const ox = (tip.sx - w / 2) / w;
      const oy = (tip.sy - h / 2) / h;

      for (const p of puffs) p.t += dt;
      while (puffs.length && puffs[0].t > PUFF_LIFE) puffs.shift();

      const held: { x: number; y: number; k: number; phase: number }[] = [];

      for (const s of spores) {
        // Spores rise on warm air and wrap back in from below.
        s.y -= (3 + s.z * 9) * dt;
        if (s.y < -12) {
          s.y = h + 12;
          s.x = Math.random() * w;
        }

        const { x, y, k } = place(s, time, ox, oy);
        if (k > 0) held.push({ x, y, k, phase: s.phase });

        const breathe = 0.55 + 0.45 * Math.sin(time * s.breath + s.phase);
        const alpha = Math.min(1, (0.14 + s.z * 0.5) * breathe + k * 0.55);
        const r = 0.5 + s.z * 1.2 + k * 0.8;
        drawSpore(ctx, x, y, r, k > 0.2 ? pal.glow : pal.grain, alpha);
      }

      // Hyphae: tip → held spores, and held spore ↔ held spore.
      if (held.length) {
        ctx.strokeStyle = pal.thread;
        ctx.lineWidth = 0.8;
        for (let i = 0; i < held.length; i++) {
          const a = held[i];
          ctx.globalAlpha = a.k * 0.7;
          thread(tip.sx, tip.sy, a.x, a.y, a.phase, time);
          for (let j = i + 1; j < held.length; j++) {
            const b = held[j];
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (d < NEIGHBOUR_RADIUS) {
              ctx.globalAlpha = Math.min(a.k, b.k) * (1 - d / NEIGHBOUR_RADIUS) * 0.5;
              thread(a.x, a.y, b.x, b.y, a.phase + b.phase, time);
            }
          }
        }
        // The tip itself: a small living spore.
        drawSpore(ctx, tip.sx, tip.sy, 1.6, pal.glow, 0.7 * tip.inside);
      }

      // Now and then a floating spore germinates on its own.
      nextSprout -= dt;
      if (nextSprout <= 0 && spores.length) {
        nextSprout = 7 + Math.random() * 8;
        const near = spores.filter((s) => s.z > 0.55);
        const s = near[Math.floor(Math.random() * near.length)];
        if (s) {
          const { x, y } = place(s, time, ox, oy);
          const r = host.getBoundingClientRect();
          germinate(r.left + x, r.top + y, { size: 11, spores: true, hold: 0.4 });
          s.y = h + 12; // it's spent — a fresh one drifts in from below
        }
      }

      ctx.globalAlpha = 1;
    };
    raf = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      host.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
      host.removeEventListener('pointerdown', onDown);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden="true"
      className="absolute inset-0 w-full h-full pointer-events-none myc-fade-in"
    />
  );
}
