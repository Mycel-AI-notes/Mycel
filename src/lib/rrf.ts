/**
 * Reciprocal Rank Fusion: merge multiple ranked lists into one without
 * needing comparable scores between them.
 *
 *   score(doc) = Σ_source 1 / (k + rank_source(doc))
 *
 * `k` is a constant (60 is the value the original paper uses and what
 * most retrieval systems converge on). It controls how steeply later
 * ranks get penalized — small `k` lets the top-of-list dominate;
 * large `k` flattens the curve so middle-of-list items still get
 * credit from being in multiple sources.
 *
 * Why RRF: the keyword search returns title-fuzz scores in roughly
 * 10–100; semantic search returns cosine distance in [0, 2]. Those
 * scales are not comparable, so any "weighted sum" merge invents a
 * relationship that doesn't exist. RRF only looks at *ranks*, which
 * are well-defined regardless of how each source scored its hits.
 */
export const RRF_K = 60;

export interface RankedItem<TKey> {
  key: TKey;
}

export interface RankedList<TKey> {
  items: RankedItem<TKey>[];
}

export interface FusedItem<TKey> {
  key: TKey;
  score: number;
  /// Index in `sources` of every list this item appeared in. Useful
  /// when the UI wants to badge "name", "content", or both.
  sources: number[];
}

export function reciprocalRankFusion<TKey>(
  sources: RankedList<TKey>[],
  k = RRF_K,
): FusedItem<TKey>[] {
  const acc = new Map<string, FusedItem<TKey>>();

  sources.forEach((source, sourceIdx) => {
    source.items.forEach((item, rank) => {
      // String-key the Map so TKey types like `{ path, title }` work
      // (otherwise Map uses reference equality and never merges).
      const id = stableKey(item.key);
      const contribution = 1 / (k + rank);
      const existing = acc.get(id);
      if (existing) {
        existing.score += contribution;
        if (!existing.sources.includes(sourceIdx)) {
          existing.sources.push(sourceIdx);
        }
      } else {
        acc.set(id, {
          key: item.key,
          score: contribution,
          sources: [sourceIdx],
        });
      }
    });
  });

  return [...acc.values()].sort((a, b) => b.score - a.score);
}

function stableKey<TKey>(key: TKey): string {
  if (typeof key === 'string') return key;
  if (typeof key === 'number' || typeof key === 'boolean') return String(key);
  // Object keys: stringify with sorted props so different reference
  // shapes with the same content collapse. RRF callers in practice
  // use a single primitive identifier (note path), so this branch is
  // a defensive default rather than a hot path.
  try {
    return JSON.stringify(key, Object.keys(key as object).sort());
  } catch {
    return String(key);
  }
}
