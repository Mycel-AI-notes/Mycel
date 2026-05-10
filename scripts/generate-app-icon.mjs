#!/usr/bin/env node
/**
 * Generates `src-tauri/app-icon.svg` — the source asset for `tauri icon`.
 * Bakes the same `BRANCHES_FULL` geometry that ships in
 * `src/components/brand/Spore.tsx` so the desktop app icon stays in
 * sync with the in-app brand mark.
 *
 * Usage:
 *   node scripts/generate-app-icon.mjs
 *   npx tauri icon src-tauri/app-icon.svg
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, '..', 'src-tauri', 'app-icon.svg');

const CANVAS = 1024;
const CX = 512;
const CY = 512;

/**
 * macOS app-icon template: artwork lives on a 824² "squircle" inside a
 * 1024² canvas, with ~100px transparent padding around it. The corner
 * radius below (≈22.37% of 824) approximates the macOS quintic super-
 * ellipse closely enough for everyday viewing — exact path-level match
 * is overkill for what 99% of users perceive as "the rounded mac shape".
 *
 * https://developer.apple.com/design/resources/ (macOS app icon)
 */
const INSET   = 100;
const TILE    = CANVAS - INSET * 2; // 824
const RADIUS  = Math.round(TILE * 0.2237); // ≈184

/**
 * Spore scale on the 100-unit BRANCHES grid. With S=9.5 the outermost
 * terminal sits ~30px inside the squircle's straight edge, leaving the
 * organism breathing room from the rounded corners.
 */
const S = 9.5;

// Mirror of BRANCHES_FULL in src/components/brand/Spore.tsx.
const BRANCHES = [
  { angle: -86, len: 36, term: 4.2, curve:  3 },
  { angle: -54, len: 21, term: 2.2, curve: -2.5, mid: { at: 0.55, r: 1.6 } },
  { angle: -16, len: 32, term: 3.4, curve:  4,
    fork: { spread: 18, tipLen: 7, tipR: 2.1 } },
  { angle:  22, len: 18, term: 2.0, curve: -3 },
  { angle:  62, len: 33, term: 3.6, curve:  3 },
  { angle:  98, len: 21, term: 2.3, curve: -3, mid: { at: 0.5, r: 1.5 } },
  { angle: 138, len: 30, term: 3.8, curve:  3.5 },
  { angle: 172, len: 16, term: 1.7, curve: -2.5 },
  { angle: 208, len: 32, term: 3.2, curve:  3, mid: { at: 0.6, r: 1.5 } },
  { angle: 246, len: 22, term: 2.4, curve: -3 },
];

const SURFACE  = '#0A0E14';
const ACCENT   = '#C8F52A';
const BRIGHT   = '#D7FF3F';

const toRad = (d) => (d * Math.PI) / 180;
const polar = (cx, cy, deg, r) => [
  cx + Math.cos(toRad(deg)) * r,
  cy + Math.sin(toRad(deg)) * r,
];
const f = (n) => n.toFixed(1);

const hyphae = [];
const forks = [];
const termSpores = [];
const midSpores = [];
const forkTips = [];

for (const b of BRANCHES) {
  const len   = b.len   * S;
  const term  = b.term  * S;
  const curve = b.curve * S;

  const [ex, ey] = polar(CX, CY, b.angle, len);
  const [mx, my] = polar(CX, CY, b.angle, len * 0.5);
  const [cx, cy] = polar(mx, my, b.angle + 90, curve);
  hyphae.push(`M ${CX} ${CY} Q ${f(cx)} ${f(cy)} ${f(ex)} ${f(ey)}`);

  if (b.mid) {
    const [mxP, myP] = polar(CX, CY, b.angle, len * b.mid.at);
    midSpores.push({ x: mxP, y: myP, r: b.mid.r * S });
  }

  if (b.fork) {
    const tipLen = b.fork.tipLen * S;
    const tipR   = b.fork.tipR   * S;
    const [lx, ly] = polar(ex, ey, b.angle - b.fork.spread, tipLen);
    const [rx, ry] = polar(ex, ey, b.angle + b.fork.spread, tipLen);
    forks.push(`M ${f(ex)} ${f(ey)} L ${f(lx)} ${f(ly)}`);
    forks.push(`M ${f(ex)} ${f(ey)} L ${f(rx)} ${f(ry)}`);
    forkTips.push({ x: lx, y: ly, r: tipR });
    forkTips.push({ x: rx, y: ry, r: tipR });
  } else {
    termSpores.push({ x: ex, y: ey, r: term });
  }
}

const STROKE = 2.4 * S;

const circle = (c) => `<circle cx="${f(c.x)}" cy="${f(c.y)}" r="${f(c.r)}"/>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${CANVAS}" height="${CANVAS}" viewBox="0 0 ${CANVAS} ${CANVAS}">
  <defs>
    <radialGradient id="glow" cx="50%" cy="50%" r="55%">
      <stop offset="0%"  stop-color="${ACCENT}" stop-opacity="0.20"/>
      <stop offset="55%" stop-color="${ACCENT}" stop-opacity="0.05"/>
      <stop offset="100%" stop-color="${ACCENT}" stop-opacity="0"/>
    </radialGradient>
    <clipPath id="squircle">
      <rect x="${INSET}" y="${INSET}" width="${TILE}" height="${TILE}"
            rx="${RADIUS}" ry="${RADIUS}"/>
    </clipPath>
  </defs>

  <!-- Everything renders inside the macOS-style squircle; the rest of
       the canvas stays transparent so the OS shows native rounded edges. -->
  <g clip-path="url(#squircle)">
    <rect x="${INSET}" y="${INSET}" width="${TILE}" height="${TILE}" fill="${SURFACE}"/>
    <rect x="${INSET}" y="${INSET}" width="${TILE}" height="${TILE}" fill="url(#glow)"/>

    <g fill="none" stroke="${ACCENT}" stroke-width="${f(STROKE)}" stroke-linecap="round">
${hyphae.map((d) => `      <path d="${d}"/>`).join('\n')}
${forks .map((d) => `      <path d="${d}"/>`).join('\n')}
    </g>

    <g fill="${ACCENT}" opacity="0.9">
${midSpores.map((c) => `      ${circle(c)}`).join('\n')}
    </g>

    <g fill="${ACCENT}">
${termSpores.map((c) => `      ${circle(c)}`).join('\n')}
${forkTips  .map((c) => `      ${circle(c)}`).join('\n')}
    </g>

    <circle cx="${CX}" cy="${CY}" r="${f(11   * S)}" fill="${ACCENT}" opacity="0.25"/>
    <circle cx="${CX}" cy="${CY}" r="${f(7.5  * S)}" fill="${ACCENT}" opacity="0.65"/>
    <circle cx="${CX}" cy="${CY}" r="${f(5    * S)}" fill="${BRIGHT}"/>
  </g>
</svg>
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, svg, 'utf8');
console.log(`wrote ${OUT}`);
