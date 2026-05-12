// Stable per-value pastel color so the same option always paints the same hue.
// 12 hand-picked hues spread around the wheel — keeps the palette friendly and
// avoids the muddy blues/greens you get from a uniform 360° hash.
export const TAG_HUES = [12, 36, 54, 86, 130, 160, 186, 212, 238, 268, 296, 332];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/// Returns the hue index (0..TAG_HUES.length-1) used for `value`, honoring the
/// per-option override map when present.
export function tagHueIndex(
  value: string,
  overrides?: Record<string, number>,
): number {
  const explicit = overrides?.[value];
  if (typeof explicit === 'number' && explicit >= 0 && explicit < TAG_HUES.length) {
    return explicit;
  }
  return hash(value) % TAG_HUES.length;
}

export function tagStyle(
  value: string,
  overrides?: Record<string, number>,
): React.CSSProperties {
  const hue = TAG_HUES[tagHueIndex(value, overrides)];
  return { '--db-tag-hue': String(hue) } as React.CSSProperties;
}

/// Returns the bare HSL string for a hue index, useful for swatch buttons in
/// pickers (so the swatch matches the rendered tag).
export function tagSwatchColor(hueIndex: number): string {
  return `hsl(${TAG_HUES[hueIndex]} 80% 75%)`;
}
