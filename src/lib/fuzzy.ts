/**
 * The fuzzy matcher behind the quick switcher, shared with the command
 * palette and the template picker so "type a few letters of it" means the
 * same thing in every list the app offers.
 *
 * Deliberately simple: a subsequence test to decide *whether* something
 * matches, and a three-tier score (prefix > substring > scattered) to decide
 * the order. Good enough for lists of a few hundred items, and predictable —
 * the user can see why a row matched.
 */

/** Does every character of `query` appear in `text`, in order? */
export function fuzzyMatch(query: string, text: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) qi++;
  }
  return qi === q.length;
}

/** Rank a match: 100 for a prefix, 50 for a substring, 10 otherwise. */
export function fuzzyScore(query: string, text: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  if (t.startsWith(q)) return 100;
  if (t.includes(q)) return 50;
  return 10;
}

/**
 * Filter and sort `items` by how well `query` matches the text `key` returns.
 * Ties keep their input order, so a caller's own ordering (alphabetical,
 * by section) survives as the secondary sort.
 */
export function fuzzyFilter<T>(items: T[], query: string, key: (item: T) => string): T[] {
  const q = query.trim();
  if (!q) return items.slice();
  return items
    .map((item, index) => ({ item, index, text: key(item) }))
    .filter((x) => fuzzyMatch(q, x.text))
    .sort((a, b) => fuzzyScore(q, b.text) - fuzzyScore(q, a.text) || a.index - b.index)
    .map((x) => x.item);
}
