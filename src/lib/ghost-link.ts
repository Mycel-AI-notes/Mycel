/**
 * Ghost links: while typing, if the words just before the cursor are the
 * start of an existing note's title, offer the rest of that title as faint
 * "ghost" text; Tab turns the typed words into a `[[wikilink]]`.
 *
 * This file is the pure matcher (no CodeMirror), so the rules that decide
 * when a suggestion is worth showing can be unit tested.
 */

/** Shortest typed fragment worth completing — shorter is mostly noise. */
export const GHOST_MIN_CHARS = 4;
/** How far back from the cursor a multi-word fragment may start. */
const LOOKBACK = 48;
/** Titles to scan per fragment before settling on the shortest so far. */
const SCAN_LIMIT = 64;

export interface TitleIndex {
  /** Lower-cased titles, sorted, paired with the original spelling. */
  keys: string[];
  titles: string[];
}

export function buildTitleIndex(titles: Iterable<string>): TitleIndex {
  const uniq = new Map<string, string>();
  for (const t of titles) {
    const title = t.trim();
    if (title.length < GHOST_MIN_CHARS + 1) continue;
    const key = title.toLowerCase();
    if (!uniq.has(key)) uniq.set(key, title);
  }
  const keys = [...uniq.keys()].sort();
  return { keys, titles: keys.map((k) => uniq.get(k)!) };
}

function lowerBound(keys: string[], s: string): number {
  let lo = 0;
  let hi = keys.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (keys[mid] < s) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The shortest title extending `fragment` (case-insensitive), if any. */
function completeFragment(index: TitleIndex, fragment: string): string | null {
  const s = fragment.toLowerCase();
  let best: string | null = null;
  for (let i = lowerBound(index.keys, s), n = 0; i < index.keys.length && n < SCAN_LIMIT; i++, n++) {
    const key = index.keys[i];
    if (!key.startsWith(s)) break;
    if (key.length === s.length) continue; // nothing left to suggest
    if (!best || key.length < best.length) best = index.titles[i];
  }
  return best;
}

export interface GhostMatch {
  /** Offset in `before` where the linked fragment starts. */
  from: number;
  /** The full title to link. */
  title: string;
  /** What the ghost shows after the cursor. */
  rest: string;
}

/**
 * `before` is the current line up to the cursor. Returns the longest
 * fragment ending at the cursor that starts on a word boundary and begins
 * some note title — or null when the cursor is inside a link, inline code,
 * or there is nothing worth suggesting.
 */
export function findGhostLink(
  before: string,
  index: TitleIndex,
  exclude?: string,
): GhostMatch | null {
  if (index.keys.length === 0) return null;
  // Already inside an unfinished [[link]] — the regular completion owns it.
  if (before.lastIndexOf('[[') > before.lastIndexOf(']]')) return null;
  // Inside inline code.
  if ((before.match(/`/g)?.length ?? 0) % 2 === 1) return null;
  // Only complete at the end of a word being typed.
  if (!/[\p{L}\p{N}]$/u.test(before)) return null;

  const start = Math.max(0, before.length - LOOKBACK);
  const excludeKey = exclude?.toLowerCase();
  for (let i = start; i <= before.length - GHOST_MIN_CHARS; i++) {
    const atBoundary = i === 0 || /[\s([{"'«—-]/u.test(before[i - 1]);
    if (!atBoundary || !/[\p{L}\p{N}]/u.test(before[i])) continue;
    const fragment = before.slice(i);
    const title = completeFragment(index, fragment);
    if (!title || title.toLowerCase() === excludeKey) continue;
    return { from: i, title, rest: title.slice(fragment.length) };
  }
  return null;
}
