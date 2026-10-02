/**
 * The local graph's data model: the `graph_local` payload turned into nodes
 * and links a d3-force simulation can run on, plus the view-box fit.
 *
 * Kept free of React and d3 so the shaping rules — who is the centre, how big
 * a node is at each depth, which links survive when tags are hidden — can be
 * tested on their own. Rendering lives in `components/graph/LocalGraph.tsx`.
 */

/** Deepest neighbourhood offered; mirrors `MAX_LOCAL_DEPTH` in `graph.rs`. */
export const MAX_LOCAL_DEPTH = 3;

export interface LocalNote {
  path: string;
  title: string;
  folder: string;
  /** Hops from the centre; 0 is the centre itself. */
  depth: number;
}

export interface LocalGraphData {
  center: string;
  notes: LocalNote[];
  wiki_edges: { from: string; to: string }[];
  tags: { tag: string; count: number }[];
  tag_edges: { from: string; tag: string }[];
}

export interface LocalNode {
  id: string;
  kind: 'note' | 'tag';
  label: string;
  /** Note path or tag name — what a click acts on. */
  target: string;
  depth: number;
  r: number;
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

export interface LocalLink {
  source: string | LocalNode;
  target: string | LocalNode;
  kind: 'wiki' | 'tag';
}

/** Clamp anything (a stale persisted value, a typo) into 1..MAX. */
export function clampDepth(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_LOCAL_DEPTH, Math.max(1, Math.round(n)));
}

/** Smaller the further out, so the centre and its direct links read first. */
const NOTE_RADIUS = [9, 6, 4.5, 3.5];

export const noteId = (path: string) => `note:${path}`;
export const tagId = (tag: string) => `tag:${tag}`;

/**
 * Nodes and links for one neighbourhood. The centre is pinned at the origin
 * so the layout grows around it instead of drifting; tags are included only
 * when `showTags` is on (the backend leaves them out otherwise too, but a
 * cached payload may still carry them).
 */
export function buildLocalModel(
  data: LocalGraphData,
  showTags: boolean,
): { nodes: LocalNode[]; links: LocalLink[] } {
  const nodes: LocalNode[] = [];
  const links: LocalLink[] = [];
  const present = new Set<string>();

  for (const n of data.notes) {
    const id = noteId(n.path);
    present.add(id);
    const center = n.path === data.center;
    nodes.push({
      id,
      kind: 'note',
      label: n.title,
      target: n.path,
      depth: n.depth,
      r: NOTE_RADIUS[Math.min(n.depth, NOTE_RADIUS.length - 1)],
      ...(center ? { x: 0, y: 0, fx: 0, fy: 0 } : {}),
    });
  }

  const seen = new Set<string>();
  for (const e of data.wiki_edges) {
    const s = noteId(e.from);
    const t = noteId(e.to);
    if (!present.has(s) || !present.has(t)) continue;
    // `a→b` and `b→a` are one line on screen.
    const key = s < t ? `${s}|${t}` : `${t}|${s}`;
    if (seen.has(key)) continue;
    seen.add(key);
    links.push({ source: s, target: t, kind: 'wiki' });
  }

  if (showTags) {
    for (const t of data.tags) {
      const id = tagId(t.tag);
      present.add(id);
      nodes.push({
        id,
        kind: 'tag',
        label: `#${t.tag}`,
        target: t.tag,
        depth: Infinity,
        r: 3.5 + Math.min(4, Math.sqrt(t.count)),
      });
    }
    for (const e of data.tag_edges) {
      const s = noteId(e.from);
      const t = tagId(e.tag);
      if (present.has(s) && present.has(t)) links.push({ source: s, target: t, kind: 'tag' });
    }
  }

  return { nodes, links };
}

/**
 * SVG viewBox that fits every positioned node with `pad` around it, never
 * smaller than `minSize` across so a two-node graph is not blown up to fill
 * the panel.
 */
export function fitViewBox(
  nodes: Pick<LocalNode, 'x' | 'y' | 'r'>[],
  pad = 24,
  minSize = 160,
): { x: number; y: number; w: number; h: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const n of nodes) {
    if (n.x === undefined || n.y === undefined) continue;
    minX = Math.min(minX, n.x - n.r);
    minY = Math.min(minY, n.y - n.r);
    maxX = Math.max(maxX, n.x + n.r);
    maxY = Math.max(maxY, n.y + n.r);
  }
  if (!Number.isFinite(minX)) {
    return { x: -minSize / 2, y: -minSize / 2, w: minSize, h: minSize };
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const w = Math.max(minSize, maxX - minX + pad * 2);
  const h = Math.max(minSize, maxY - minY + pad * 2);
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}
