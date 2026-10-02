import { useEffect, useRef } from 'react';
import { cosmicPalette, nebulaBurst } from '@/lib/cosmic-fx';

/**
 * Interactive starfield behind the empty editor.
 *
 *   - three depth layers drift slowly and parallax against the cursor;
 *   - the cursor is a small gravity well: nearby stars lean in and thread
 *     themselves to it (and to each other) like a constellation — or a
 *     mycelium, which is the point;
 *   - a click ignites a supernova and sends a shockwave through the field;
 *   - every so often a shooting star crosses the sky.
 *
 * It listens on its parent element so content layered on top (the logo,
 * the hint) does not block the pointer.
 */

interface Star {
  x: number;
  y: number;
  /** depth 0.25..1 — nearer stars are bigger, brighter and move more */
  z: number;
  phase: number;
  speed: number;
}

interface Wave {
  x: number;
  y: number;
  t: number;
}

interface Shooter {
  x: number;
  y: number;
  vx: number;
  vy: number;
  t: number;
  ttl: number;
}

const LINK_RADIUS = 130;
const NEIGHBOUR_RADIUS = 70;

export function Starfield() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !host || !ctx) return;

    let w = 0;
    let h = 0;
    let dpr = 1;
    let stars: Star[] = [];
    const waves: Wave[] = [];
    let shooter: Shooter | null = null;
    let nextShooter = 4 + Math.random() * 6;
    let pal = cosmicPalette();
    let frame = 0;
    let raf = 0;
    let last = performance.now();

    // Pointer, raw and smoothed. `inside` fades the cursor links in and out.
    const mouse = { x: 0, y: 0, sx: 0, sy: 0, inside: 0, target: 0 };

    const seed = () => {
      const count = Math.min(260, Math.round((w * h) / 5200));
      stars = Array.from({ length: count }, () => ({
        x: Math.random() * w,
        y: Math.random() * h,
        z: 0.25 + Math.pow(Math.random(), 2.2) * 0.75,
        phase: Math.random() * Math.PI * 2,
        speed: 0.6 + Math.random() * 1.6,
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
      if (grew || !stars.length) seed();
      mouse.sx = mouse.x = w / 2;
      mouse.sy = mouse.y = h / 2;
    };

    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();

    const onMove = (e: PointerEvent) => {
      const r = host.getBoundingClientRect();
      mouse.x = e.clientX - r.left;
      mouse.y = e.clientY - r.top;
      mouse.target = 1;
    };
    const onLeave = () => {
      mouse.target = 0;
      mouse.x = w / 2;
      mouse.y = h / 2;
    };
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0) return;
      const r = host.getBoundingClientRect();
      waves.push({ x: e.clientX - r.left, y: e.clientY - r.top, t: 0 });
      nebulaBurst(e.clientX, e.clientY, { scale: 1.1 });
    };
    host.addEventListener('pointermove', onMove);
    host.addEventListener('pointerleave', onLeave);
    host.addEventListener('pointerdown', onDown);

    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (document.hidden) {
        last = now;
        return;
      }
      const dt = Math.max(0, Math.min((now - last) / 1000, 1 / 20));
      last = now;
      const time = now / 1000;
      if (++frame % 45 === 0) pal = cosmicPalette();

      mouse.sx += (mouse.x - mouse.sx) * Math.min(1, dt * 6);
      mouse.sy += (mouse.y - mouse.sy) * Math.min(1, dt * 6);
      mouse.inside += (mouse.target - mouse.inside) * Math.min(1, dt * 4);

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);
      ctx.globalCompositeOperation = pal.dark ? 'lighter' : 'source-over';

      // Parallax offset — nearer layers move more.
      const ox = (mouse.sx - w / 2) / w;
      const oy = (mouse.sy - h / 2) / h;

      for (const wv of waves) wv.t += dt;
      while (waves.length && waves[0].t > 1.6) waves.shift();

      const lit: { x: number; y: number; k: number }[] = [];

      for (const s of stars) {
        // Slow drift to the left, wrapping around.
        s.x -= s.z * 4 * dt;
        if (s.x < -10) s.x += w + 20;

        let x = s.x - ox * 28 * s.z;
        let y = s.y - oy * 20 * s.z;

        // Shockwaves push stars outward as the ring passes them.
        for (const wv of waves) {
          const dx = x - wv.x;
          const dy = y - wv.y;
          const d = Math.hypot(dx, dy) || 1;
          const front = wv.t * 520;
          const band = Math.exp(-Math.pow((d - front) / 40, 2));
          const push = band * 26 * (1 - wv.t / 1.6) * s.z;
          x += (dx / d) * push;
          y += (dy / d) * push;
        }

        // Gravity well: lean toward the cursor.
        const mdx = mouse.sx - x;
        const mdy = mouse.sy - y;
        const md = Math.hypot(mdx, mdy);
        let k = 0;
        if (md < LINK_RADIUS && mouse.inside > 0.01) {
          k = (1 - md / LINK_RADIUS) * mouse.inside;
          const pull = k * k * 14 * s.z;
          x += (mdx / (md || 1)) * pull;
          y += (mdy / (md || 1)) * pull;
          lit.push({ x, y, k });
        }

        const twinkle = 0.55 + 0.45 * Math.sin(time * s.speed + s.phase);
        const alpha = (0.18 + s.z * 0.6) * twinkle + k * 0.5;
        const r = 0.4 + s.z * 1.1 + k * 0.9;
        ctx.globalAlpha = Math.min(1, alpha);
        ctx.fillStyle = k > 0.15 ? pal.bright : pal.star;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fill();
      }

      // Constellation threads: cursor → lit stars, and lit star ↔ lit star.
      if (lit.length) {
        ctx.lineWidth = 0.6;
        ctx.strokeStyle = pal.bright;
        for (let i = 0; i < lit.length; i++) {
          const a = lit[i];
          ctx.globalAlpha = a.k * 0.35;
          ctx.beginPath();
          ctx.moveTo(mouse.sx, mouse.sy);
          ctx.lineTo(a.x, a.y);
          ctx.stroke();
          for (let j = i + 1; j < lit.length; j++) {
            const b = lit[j];
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (d < NEIGHBOUR_RADIUS) {
              ctx.globalAlpha = Math.min(a.k, b.k) * (1 - d / NEIGHBOUR_RADIUS) * 0.4;
              ctx.beginPath();
              ctx.moveTo(a.x, a.y);
              ctx.lineTo(b.x, b.y);
              ctx.stroke();
            }
          }
        }
        // Soft halo around the cursor so the well reads as a light source.
        const g = ctx.createRadialGradient(mouse.sx, mouse.sy, 0, mouse.sx, mouse.sy, 46);
        g.addColorStop(0, pal.bright);
        g.addColorStop(1, 'transparent');
        ctx.globalAlpha = 0.08 * mouse.inside;
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(mouse.sx, mouse.sy, 46, 0, Math.PI * 2);
        ctx.fill();
      }

      // Shockwave rings.
      for (const wv of waves) {
        const t = wv.t / 1.6;
        ctx.globalAlpha = (1 - t) * 0.25;
        ctx.strokeStyle = pal.bright;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.arc(wv.x, wv.y, wv.t * 520, 0, Math.PI * 2);
        ctx.stroke();
      }

      // An occasional shooting star.
      nextShooter -= dt;
      if (!shooter && nextShooter <= 0) {
        const fromLeft = Math.random() < 0.5;
        const speed = 520 + Math.random() * 260;
        const angle = (fromLeft ? 0.35 : Math.PI - 0.35) + (Math.random() - 0.5) * 0.3;
        shooter = {
          x: fromLeft ? Math.random() * w * 0.5 : w * 0.5 + Math.random() * w * 0.5,
          y: Math.random() * h * 0.4,
          vx: Math.cos(angle) * speed,
          vy: Math.sin(angle) * speed,
          t: 0,
          ttl: 0.9,
        };
        nextShooter = 7 + Math.random() * 9;
      }
      if (shooter) {
        shooter.t += dt;
        shooter.x += shooter.vx * dt;
        shooter.y += shooter.vy * dt;
        const t = shooter.t / shooter.ttl;
        const tail = ctx.createLinearGradient(
          shooter.x,
          shooter.y,
          shooter.x - shooter.vx * 0.12,
          shooter.y - shooter.vy * 0.12,
        );
        tail.addColorStop(0, pal.star);
        tail.addColorStop(1, 'transparent');
        ctx.globalAlpha = Math.sin(Math.PI * Math.min(1, t)) * 0.8;
        ctx.strokeStyle = tail;
        ctx.lineWidth = 1.2;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(shooter.x, shooter.y);
        ctx.lineTo(shooter.x - shooter.vx * 0.12, shooter.y - shooter.vy * 0.12);
        ctx.stroke();
        if (t >= 1) shooter = null;
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
      className="absolute inset-0 w-full h-full pointer-events-none cosmic-fade-in"
    />
  );
}
