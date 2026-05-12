// Stable per-value pastel color so the same option always paints the same hue.
// 12 hand-picked hues spread around the wheel — keeps the palette friendly and
// avoids the muddy blues/greens you get from a uniform 360° hash.
const HUES = [12, 36, 54, 86, 130, 160, 186, 212, 238, 268, 296, 332];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function tagStyle(value: string): React.CSSProperties {
  const hue = HUES[hash(value) % HUES.length];
  return { '--db-tag-hue': String(hue) } as React.CSSProperties;
}
