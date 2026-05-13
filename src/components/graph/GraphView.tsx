import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { clsx } from 'clsx';
import {
  forceCenter,
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
} from 'd3-force';
import {
  Folder,
  Globe,
  Hash,
  Link2,
  Loader2,
  Maximize2,
  RotateCcw,
  Sparkles,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useVaultStore } from '@/stores/vault';
import { useAiStore } from '@/stores/ai';
import { openUrl } from '@tauri-apps/plugin-opener';
import { TagSearch } from '@/components/search/TagSearch';

const TAG_GROUP = '__tags__';

const isMac =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform);

// ── Wire types matching the Rust `graph_data` payload ───────────────────────

interface GraphNote { path: string; title: string; folder: string; }
interface GraphFolder { path: string; name: string; parent: string | null; }
interface GraphDomain { domain: string; count: number; }
interface GraphTag { tag: string; count: number; }
interface WikiEdge { from: string; to: string; }
interface ExternalEdge { from: string; domain: string; count: number; }
interface TagEdge { from: string; tag: string; }
interface GraphData {
  notes: GraphNote[];
  folders: GraphFolder[];
  domains: GraphDomain[];
  tags: GraphTag[];
  wiki_edges: WikiEdge[];
  external_edges: ExternalEdge[];
  tag_edges: TagEdge[];
}

// ── Internal simulation types ───────────────────────────────────────────────

type NodeKind = 'folder' | 'note' | 'domain' | 'tag';

interface SimNode {
  id: string;
  kind: NodeKind;
  label: string;
  /** For notes: parent folder path. For folders: parent folder. For domains: '__external__'. For tags: '__tags__'. */
  group: string;
  /** Display radius. */
  r: number;
  /** Reference count — drives domain/tag node sizing. */
  count?: number;
  // d3-force will populate these
  x?: number;
  y?: number;
  vx?: number;
  vy?: number;
  fx?: number | null;
  fy?: number | null;
}

interface SimLink {
  source: string | SimNode;
  target: string | SimNode;
  kind: 'contain' | 'wiki' | 'external' | 'tag' | 'semantic';
  /** Edge strength scaler (1 for normal, used for domain counts). */
  weight?: number;
  /** Cosine similarity for semantic edges; drives line opacity so
   *  stronger pairs read more confidently. Undefined for other kinds. */
  score?: number;
}

interface SemanticEdgePayload {
  a_path: string;
  b_path: string;
  score: number;
}

interface Props {
  onClose: () => void;
}

const EXTERNAL_GROUP = '__external__';

export function GraphView({ onClose }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const simRef = useRef<Simulation<SimNode, SimLink> | null>(null);
  const [data, setData] = useState<GraphData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [hover, setHover] = useState<SimNode | null>(null);
  const [tagQuery, setTagQuery] = useState<string | null>(null);
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const [show, setShow] = useState({
    wiki: true,
    tags: true,
    domains: true,
    folders: true,
    semantic: false,
  });
  const [, force] = useState(0); // tick re-render trigger
  const { openNote } = useVaultStore();
  const aiStatus = useAiStore((s) => s.status);
  const aiIndex = useAiStore((s) => s.indexStatus);

  // Semantic-edges UI state. Threshold matches the spec (0.6-0.95,
  // default 0.75). Edges are fetched lazily on toggle-on and
  // re-fetched whenever the threshold settles, so a freshly dragged
  // slider doesn't re-query mid-drag.
  const [threshold, setThreshold] = useState(0.75);
  const [semanticEdges, setSemanticEdges] = useState<SemanticEdgePayload[]>([]);
  const [edgesRecomputing, setEdgesRecomputing] = useState(false);
  const [edgesProgress, setEdgesProgress] = useState<{ done: number; total: number } | null>(null);

  const semanticAvailable =
    !!aiStatus?.enabled &&
    !!aiStatus?.has_key &&
    (aiIndex?.chunks_indexed ?? 0) > 0;

  // ── Fetch ────────────────────────────────────────────────────────────────
  useEffect(() => {
    invoke<GraphData>('graph_data')
      .then(setData)
      .catch((e) => setError(String(e)));
  }, []);

  // ── Semantic edges ──────────────────────────────────────────────────────
  //
  // Subscribe to progress events once per mount. The listener stays
  // attached even if the toggle is off — it costs nothing when no
  // events fire, and re-attaching on every toggle change would just
  // churn handles.
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;
    void listen<{ done: number; total: number }>('ai-edges-progress', (e) => {
      setEdgesProgress(e.payload);
    }).then((u) => {
      unlisten = u;
    });
    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  // Fetch (or recompute then fetch) when the toggle goes on or the
  // threshold settles. We debounce the threshold so dragging the
  // slider doesn't fire a query per frame; the query itself is fast
  // but the round-trip + state churn would still spam the renderer.
  useEffect(() => {
    if (!show.semantic || !semanticAvailable) {
      setSemanticEdges([]);
      return;
    }
    let cancelled = false;
    const handle = setTimeout(async () => {
      try {
        const status = await invoke<{ total: number }>('ai_edges_status');
        if (cancelled) return;
        if (status.total === 0) {
          // First time the toggle is flipped on for this vault — run
          // the O(N²) pass before we can render anything.
          setEdgesRecomputing(true);
          setEdgesProgress(null);
          try {
            await invoke('ai_recompute_edges');
          } finally {
            if (!cancelled) {
              setEdgesRecomputing(false);
              setEdgesProgress(null);
            }
          }
          if (cancelled) return;
        }
        const edges = await invoke<SemanticEdgePayload[]>(
          'ai_list_semantic_edges',
          { args: { threshold } },
        );
        if (!cancelled) setSemanticEdges(edges);
      } catch {
        // Silent: an error here means the toggle just won't render
        // edges. The toolbar still shows the toggle state, and the
        // user can flip it off.
        if (!cancelled) setSemanticEdges([]);
      }
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(handle);
    };
  }, [show.semantic, semanticAvailable, threshold]);

  const recomputeEdges = async () => {
    if (edgesRecomputing || !semanticAvailable) return;
    setEdgesRecomputing(true);
    setEdgesProgress(null);
    try {
      await invoke('ai_recompute_edges');
      const edges = await invoke<SemanticEdgePayload[]>(
        'ai_list_semantic_edges',
        { args: { threshold } },
      );
      setSemanticEdges(edges);
    } catch {
      // ignored — see comment above
    } finally {
      setEdgesRecomputing(false);
      setEdgesProgress(null);
    }
  };

  // ── Esc-to-close ─────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  // ── Build sim model from raw data ────────────────────────────────────────
  const { nodes, links } = useMemo(() => {
    if (!data) return { nodes: [] as SimNode[], links: [] as SimLink[] };

    const nodes: SimNode[] = [];
    const links: SimLink[] = [];

    const folderNoteCount = new Map<string, number>();
    for (const n of data.notes) {
      folderNoteCount.set(n.folder, (folderNoteCount.get(n.folder) ?? 0) + 1);
    }
    // Folder nodes (synthetic root '' is intentionally not rendered).
    if (show.folders) {
      for (const f of data.folders) {
        if (f.path === '') continue;
        const noteCount = folderNoteCount.get(f.path) ?? 0;
        nodes.push({
          id: `folder:${f.path}`,
          kind: 'folder',
          label: f.name,
          group: f.parent ?? '',
          r: 9 + Math.min(8, Math.sqrt(noteCount) * 2.4),
        });
      }
      for (const f of data.folders) {
        if (f.parent === null || f.parent === '') continue;
        links.push({
          source: `folder:${f.parent}`,
          target: `folder:${f.path}`,
          kind: 'contain',
        });
      }
    }

    for (const n of data.notes) {
      nodes.push({
        id: `note:${n.path}`,
        kind: 'note',
        label: n.title,
        group: n.folder,
        r: 6,
      });
      if (show.folders && n.folder !== '') {
        links.push({
          source: `folder:${n.folder}`,
          target: `note:${n.path}`,
          kind: 'contain',
        });
      }
    }

    if (show.wiki) {
      for (const e of data.wiki_edges) {
        links.push({
          source: `note:${e.from}`,
          target: `note:${e.to}`,
          kind: 'wiki',
        });
      }
    }

    if (show.semantic) {
      // Build a set of note ids actually present so a stale edge
      // referencing a note deleted since the last edges recompute
      // doesn't crash d3-force (which dereferences source/target by id).
      const noteIds = new Set(data.notes.map((n) => `note:${n.path}`));
      for (const e of semanticEdges) {
        const from = `note:${e.a_path}`;
        const to = `note:${e.b_path}`;
        if (!noteIds.has(from) || !noteIds.has(to)) continue;
        links.push({
          source: from,
          target: to,
          kind: 'semantic',
          score: e.score,
          // Lower physical pull than wikilinks — semantic edges are
          // hints, not declared relationships, and shouldn't yank
          // explicit-link clusters apart.
          weight: 0.3,
        });
      }
    }

    if (show.tags) {
      for (const tg of data.tags) {
        nodes.push({
          id: `tag:${tg.tag}`,
          kind: 'tag',
          label: `#${tg.tag}`,
          group: TAG_GROUP,
          r: 4 + Math.min(7, Math.sqrt(tg.count) * 1.4),
          count: tg.count,
        });
      }
      for (const e of data.tag_edges) {
        links.push({
          source: `note:${e.from}`,
          target: `tag:${e.tag}`,
          kind: 'tag',
        });
      }
    }

    if (show.domains) {
      for (const d of data.domains) {
        nodes.push({
          id: `domain:${d.domain}`,
          kind: 'domain',
          label: d.domain,
          group: EXTERNAL_GROUP,
          r: 6 + Math.min(8, Math.sqrt(d.count) * 1.6),
          count: d.count,
        });
      }
      for (const e of data.external_edges) {
        links.push({
          source: `note:${e.from}`,
          target: `domain:${e.domain}`,
          kind: 'external',
          weight: e.count,
        });
      }
    }

    return { nodes, links };
  }, [data, show, semanticEdges]);

  // ── Force simulation ─────────────────────────────────────────────────────
  useEffect(() => {
    if (!nodes.length || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const cx = rect.width / 2;
    const cy = rect.height / 2;

    const sim = forceSimulation<SimNode>(nodes)
      .force(
        'link',
        forceLink<SimNode, SimLink>(links)
          .id((d) => d.id)
          .distance((l) => {
            if (l.kind === 'contain') return 40;
            if (l.kind === 'wiki') return 85;
            if (l.kind === 'tag') return 75;
            return 75; // external
          })
          .strength((l) => {
            if (l.kind === 'contain') return 0.9;
            if (l.kind === 'wiki') return 0.35;
            // Tag / external pull strong enough that shared-target notes
            // form a visible cluster around the tag/domain.
            if (l.kind === 'tag') return 0.45;
            return 0.45;
          }),
      )
      .force('charge', forceManyBody().strength(-180))
      .force(
        'collide',
        forceCollide<SimNode>().radius((d) =>
          d.kind === 'folder' ? d.r * 1.65 + 8 : d.r + 6,
        ),
      )
      .force('center', forceCenter(cx, cy))
      // Mild radial pull toward folder centroid keeps groups compact.
      .force('x', forceX<SimNode>(cx).strength(0.04))
      .force('y', forceY<SimNode>(cy).strength(0.04))
      .alphaDecay(0.035);

    simRef.current = sim;
    let raf = 0;
    const onTick = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => force((n) => n + 1));
    };
    sim.on('tick', onTick);

    return () => {
      sim.stop();
      cancelAnimationFrame(raf);
      simRef.current = null;
    };
  }, [nodes, links]);

  // ── Pan & zoom (manual, lightweight) ─────────────────────────────────────
  const panState = useRef<{ x: number; y: number; px: number; py: number } | null>(null);
  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const factor = e.deltaY > 0 ? 0.9 : 1.1;
    const rect = svgRef.current!.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    setTransform((t) => {
      const nk = Math.max(0.2, Math.min(5, t.k * factor));
      // Zoom around cursor.
      const nx = mx - ((mx - t.x) * nk) / t.k;
      const ny = my - ((my - t.y) * nk) / t.k;
      return { x: nx, y: ny, k: nk };
    });
  };

  const onBgMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0) return;
    panState.current = {
      x: transform.x,
      y: transform.y,
      px: e.clientX,
      py: e.clientY,
    };
  };
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      if (!panState.current) return;
      setTransform((t) => ({
        ...t,
        x: panState.current!.x + (e.clientX - panState.current!.px),
        y: panState.current!.y + (e.clientY - panState.current!.py),
      }));
    };
    const onUp = () => {
      panState.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, []);

  // ── Node drag ────────────────────────────────────────────────────────────
  const draggingRef = useRef<SimNode | null>(null);
  const onNodeMouseDown = (e: React.MouseEvent, n: SimNode) => {
    e.stopPropagation();
    const sim = simRef.current;
    if (!sim) return;
    draggingRef.current = n;
    sim.alphaTarget(0.3).restart();
    n.fx = n.x;
    n.fy = n.y;
  };
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const n = draggingRef.current;
      if (!n || !svgRef.current) return;
      const rect = svgRef.current.getBoundingClientRect();
      const sx = (e.clientX - rect.left - transform.x) / transform.k;
      const sy = (e.clientY - rect.top - transform.y) / transform.k;
      n.fx = sx;
      n.fy = sy;
    };
    const onUp = () => {
      const n = draggingRef.current;
      if (!n) return;
      draggingRef.current = null;
      simRef.current?.alphaTarget(0);
      n.fx = null;
      n.fy = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [transform.x, transform.y, transform.k]);

  // ── Activation ───────────────────────────────────────────────────────────
  const handleActivate = (n: SimNode) => {
    if (n.kind === 'note') {
      openNote(n.id.replace(/^note:/, '')).catch(console.error);
      onClose();
    } else if (n.kind === 'domain') {
      openUrl(`https://${n.label}`).catch(console.error);
    } else if (n.kind === 'tag') {
      setTagQuery(n.id.replace(/^tag:/, ''));
    }
  };

  const fit = () => {
    if (!nodes.length || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const n of nodes) {
      if (n.x === undefined || n.y === undefined) continue;
      minX = Math.min(minX, n.x - n.r);
      minY = Math.min(minY, n.y - n.r);
      maxX = Math.max(maxX, n.x + n.r);
      maxY = Math.max(maxY, n.y + n.r);
    }
    if (!isFinite(minX)) return;
    const pad = 60;
    const w = maxX - minX + pad * 2;
    const h = maxY - minY + pad * 2;
    const k = Math.min(rect.width / w, rect.height / h, 1.5);
    const x = rect.width / 2 - ((minX + maxX) / 2) * k;
    const y = rect.height / 2 - ((minY + maxY) / 2) * k;
    setTransform({ x, y, k });
  };

  // ── Rendering helpers ───────────────────────────────────────────────────
  // Lightweight deterministic string hash so per-edge / per-node randomness
  // doesn't flicker between renders.
  const hash = (s: string) => {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = (h * 31 + s.charCodeAt(i)) | 0;
    }
    return h;
  };

  const renderLink = (l: SimLink, i: number) => {
    const s = l.source as SimNode;
    const t = l.target as SimNode;
    if (!s || !t || s.x === undefined || t.x === undefined) return null;

    const dx = (t.x as number) - (s.x as number);
    const dy = (t.y as number) - (s.y as number);
    const dist = Math.hypot(dx, dy) || 1;

    if (l.kind === 'contain') {
      // Curved hypha: a soft accent so structure stays present without
      // outshouting the semantic wiki edges. Hub→domain / hub→tag edges
      // pick up their respective palette so the three "regions" of the
      // graph (vault / web / tags) read at a glance.
      const seed = hash(
        `${typeof l.source === 'string' ? l.source : (l.source as SimNode).id}->${
          typeof l.target === 'string' ? l.target : (l.target as SimNode).id
        }`,
      );
      const sign = (seed & 1) === 0 ? 1 : -1;
      const curve = sign * (0.16 + ((seed >>> 1) % 12) / 80) * dist;
      const mx = (s.x! + t.x!) / 2;
      const my = (s.y! + t.y!) / 2;
      const nx = -dy / dist;
      const ny = dx / dist;
      const cxp = mx + nx * curve;
      const cyp = my + ny * curve;
      const sxp = s.x! + (dx / dist) * s.r;
      const syp = s.y! + (dy / dist) * s.r;
      const exp = t.x! - (dx / dist) * t.r;
      const eyp = t.y! - (dy / dist) * t.r;
      const isFolderHierarchy = s.kind === 'folder' && t.kind === 'folder';
      const cls = isFolderHierarchy
        ? 'stroke-accent/75'
        : 'stroke-accent/60';
      return (
        <path
          key={i}
          d={`M ${sxp.toFixed(2)} ${syp.toFixed(2)} Q ${cxp.toFixed(2)} ${cyp.toFixed(2)} ${exp.toFixed(2)} ${eyp.toFixed(2)}`}
          className={cls}
          strokeWidth={isFolderHierarchy ? 1.2 : 1}
          strokeDasharray={isFolderHierarchy ? '1 4' : undefined}
          strokeLinecap="round"
          fill="none"
        />
      );
    }

    if (l.kind === 'wiki') {
      // Slight curve so two parallel wiki edges don't collapse into one line.
      const seed = hash(`w:${s.id}->${t.id}`);
      const sign = (seed & 1) === 0 ? 1 : -1;
      const curve = sign * (0.08 + ((seed >>> 1) % 10) / 100) * dist;
      const mx = (s.x! + t.x!) / 2;
      const my = (s.y! + t.y!) / 2;
      const nx = -dy / dist;
      const ny = dx / dist;
      const cxp = mx + nx * curve;
      const cyp = my + ny * curve;
      const sxp = s.x! + (dx / dist) * s.r;
      const syp = s.y! + (dy / dist) * s.r;
      const exp = t.x! - (dx / dist) * t.r;
      const eyp = t.y! - (dy / dist) * t.r;
      return (
        <path
          key={i}
          d={`M ${sxp.toFixed(2)} ${syp.toFixed(2)} Q ${cxp.toFixed(2)} ${cyp.toFixed(2)} ${exp.toFixed(2)} ${eyp.toFixed(2)}`}
          className="stroke-accent"
          strokeOpacity={0.95}
          strokeWidth={1.8}
          strokeLinecap="round"
          fill="none"
          filter="url(#wiki-glow)"
        />
      );
    }

    if (l.kind === 'semantic') {
      // Dashed amber line, straight (no glow, no curve). Visually
      // marked as derived/inferred so it doesn't read as a declared
      // wikilink. Opacity scales with the similarity score above
      // baseline 0.6 — top end (~0.95) is near-full opacity, bottom
      // is faint.
      const sxp = s.x! + (dx / dist) * s.r;
      const syp = s.y! + (dy / dist) * s.r;
      const exp = t.x! - (dx / dist) * t.r;
      const eyp = t.y! - (dy / dist) * t.r;
      const score = l.score ?? 0.6;
      // Map [0.6, 0.95] → [0.35, 0.85]. Floor keeps low-confidence
      // edges visible; ceiling keeps even perfect matches from
      // outshouting the wiki edges they sit alongside.
      const opacity = 0.35 + Math.min(1, Math.max(0, (score - 0.6) / 0.35)) * 0.5;
      return (
        <line
          key={i}
          x1={sxp.toFixed(2)}
          y1={syp.toFixed(2)}
          x2={exp.toFixed(2)}
          y2={eyp.toFixed(2)}
          className="stroke-accent-bright"
          strokeOpacity={opacity}
          strokeWidth={1}
          strokeDasharray="4 3"
          strokeLinecap="round"
        />
      );
    }

    // Helper: trim endpoints to circumferences + perpendicular Bezier curve.
    const curvedPath = (curveScale: number, prefix: string) => {
      const seed = hash(`${prefix}:${s.id}->${t.id}`);
      const sign = (seed & 1) === 0 ? 1 : -1;
      const curve = sign * (0.1 + ((seed >>> 1) % 14) / 80) * dist * curveScale;
      const mx = (s.x! + t.x!) / 2;
      const my = (s.y! + t.y!) / 2;
      const nx = -dy / dist;
      const ny = dx / dist;
      const cxp = mx + nx * curve;
      const cyp = my + ny * curve;
      const sxp = s.x! + (dx / dist) * s.r;
      const syp = s.y! + (dy / dist) * s.r;
      const exp = t.x! - (dx / dist) * t.r;
      const eyp = t.y! - (dy / dist) * t.r;
      return `M ${sxp.toFixed(2)} ${syp.toFixed(2)} Q ${cxp.toFixed(2)} ${cyp.toFixed(2)} ${exp.toFixed(2)} ${eyp.toFixed(2)}`;
    };

    if (l.kind === 'tag') {
      return (
        <path
          key={i}
          d={curvedPath(1, 't')}
          strokeWidth={1.1}
          strokeDasharray="2 3"
          className="stroke-tag"
          strokeOpacity={0.85}
          strokeLinecap="round"
          fill="none"
        />
      );
    }

    // External (note → domain): dashed
    return (
      <path
        key={i}
        d={curvedPath(0.85, 'e')}
        strokeWidth={1.1}
        strokeDasharray="3 4"
        className="stroke-embedding"
        strokeOpacity={0.85}
        strokeLinecap="round"
        fill="none"
      />
    );
  };

  const renderFolderSpore = (n: SimNode) => {
    // Spore globe — three concentric layers (soft halo, mid shell, dense
    // core) inheriting the accent palette. The "branches" of the spore are
    // the curved containment edges that actually connect to its notes, so
    // we keep the central body uncluttered.
    return (
      <g className="text-accent">
        <circle r={n.r * 1.65} fill="currentColor" opacity="0.14" />
        <circle r={n.r * 1.15} fill="currentColor" opacity="0.4" />
        <circle r={n.r * 0.75} fill="currentColor" />
        <circle
          r={n.r * 1.65}
          fill="none"
          stroke="currentColor"
          strokeOpacity="0.35"
          strokeWidth="0.8"
        />
      </g>
    );
  };

  const renderNode = (n: SimNode) => {
    if (n.x === undefined || n.y === undefined) return null;
    const isHover = hover?.id === n.id;

    return (
      <g
        key={n.id}
        transform={`translate(${n.x},${n.y})`}
        onMouseDown={(e) => onNodeMouseDown(e, n)}
        onMouseEnter={() => setHover(n)}
        onMouseLeave={() => setHover((h) => (h?.id === n.id ? null : h))}
        onDoubleClick={() => handleActivate(n)}
        className="cursor-pointer"
      >
        {isHover && (
          <circle
            r={n.r + 8}
            className={
              n.kind === 'folder'
                ? 'fill-accent opacity-25'
                : n.kind === 'domain'
                  ? 'fill-embedding opacity-25'
                  : 'fill-text-primary opacity-15'
            }
            style={{ filter: 'blur(5px)' }}
          />
        )}

        {n.kind === 'folder' ? (
          renderFolderSpore(n)
        ) : n.kind === 'domain' ? (
          <>
            <circle
              r={n.r}
              className="fill-embedding stroke-embedding"
              fillOpacity={0.75}
              strokeWidth={1}
            />
            {n.count !== undefined && n.count > 1 && (
              <text
                y={3}
                textAnchor="middle"
                className="fill-text-primary pointer-events-none select-none"
                style={{ fontSize: 9, fontWeight: 600 }}
              >
                {n.count}
              </text>
            )}
          </>
        ) : n.kind === 'tag' ? (
          <>
            {/* Outer ring to distinguish tags from folders — folder uses a
                solid multi-layer globe, tag is an open ringed marker. */}
            <circle
              r={n.r + 2}
              fill="none"
              className="stroke-tag"
              strokeOpacity={0.45}
              strokeWidth={0.8}
              strokeDasharray="1 2"
            />
            <circle
              r={n.r}
              className="fill-surface-0 stroke-tag"
              strokeWidth={1.2}
            />
            <text
              y={3}
              textAnchor="middle"
              className="fill-tag pointer-events-none select-none"
              style={{
                fontSize: Math.max(8, n.r * 1.1),
                fontWeight: 700,
              }}
            >
              #
            </text>
          </>
        ) : (
          // Note: simple "mid-bud" — a small filled spore.
          <>
            <circle
              r={n.r}
              className="fill-surface-2 stroke-text-muted"
              fillOpacity={0.9}
              strokeWidth={1}
            />
            <circle r={Math.max(1.4, n.r * 0.35)} className="fill-text-secondary" />
          </>
        )}

        {(isHover || n.kind === 'folder') && (
          <text
            x={n.kind === 'folder' ? n.r * 1.85 + 4 : n.r + 6}
            y={3}
            className={
              n.kind === 'folder'
                ? 'fill-text-primary pointer-events-none select-none'
                : 'fill-text-secondary pointer-events-none select-none'
            }
            style={{
              fontSize: n.kind === 'folder' ? 11 : 10,
              fontWeight: n.kind === 'folder' ? 600 : 400,
            }}
          >
            {n.label}
          </text>
        )}
      </g>
    );
  };

  return (
    <div className="fixed inset-0 z-50 bg-surface-0 flex flex-col">
      <div
        data-tauri-drag-region
        className={clsx(
          'flex items-center justify-between pr-4 py-2 border-b border-border bg-surface-0 shrink-0',
          isMac ? 'pl-[78px]' : 'pl-4',
        )}
      >
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-text-primary">Graph</h2>
          {data && (
            <span className="text-xs text-text-muted">
              {data.notes.length} notes · {data.wiki_edges.length} links ·{' '}
              {data.tags.length} tags · {data.domains.length} domains
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          {(
            [
              { key: 'wiki', label: 'Backlinks', icon: Link2 },
              { key: 'tags', label: 'Tags', icon: Hash },
              { key: 'domains', label: 'Domains', icon: Globe },
              { key: 'folders', label: 'Folders', icon: Folder },
            ] as const
          ).map(({ key, label, icon: Icon }) => (
            <button
              key={key}
              onClick={() => setShow((s) => ({ ...s, [key]: !s[key] }))}
              className={clsx(
                'p-1 rounded transition-colors',
                show[key]
                  ? 'text-text-primary bg-surface-2 hover:bg-surface-hover'
                  : 'text-text-muted/60 hover:text-text-secondary hover:bg-surface-hover line-through',
              )}
              title={`${show[key] ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
            >
              <Icon size={14} />
            </button>
          ))}

          {semanticAvailable && (
            <>
              <button
                onClick={() => setShow((s) => ({ ...s, semantic: !s.semantic }))}
                disabled={edgesRecomputing}
                className={clsx(
                  'p-1 rounded transition-colors disabled:opacity-60 disabled:cursor-not-allowed',
                  show.semantic
                    ? 'text-accent bg-surface-2 hover:bg-surface-hover'
                    : 'text-text-muted/60 hover:text-text-secondary hover:bg-surface-hover line-through',
                )}
                title={
                  edgesRecomputing
                    ? 'Computing semantic edges…'
                    : show.semantic
                    ? 'Hide AI-derived edges'
                    : 'Show AI-derived edges'
                }
              >
                {edgesRecomputing ? (
                  <Loader2 size={14} className="animate-spin" />
                ) : (
                  <Sparkles size={14} />
                )}
              </button>
              {show.semantic && !edgesRecomputing && (
                <div
                  className="flex items-center gap-1.5 ml-1"
                  title="Semantic similarity threshold"
                >
                  <input
                    type="range"
                    min={0.6}
                    max={0.95}
                    step={0.01}
                    value={threshold}
                    onChange={(e) => setThreshold(parseFloat(e.target.value))}
                    className="w-20 accent-accent"
                  />
                  <span className="text-[10px] tabular-nums text-text-muted w-7 text-right">
                    {threshold.toFixed(2)}
                  </span>
                  <button
                    onClick={() => void recomputeEdges()}
                    className="p-0.5 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary"
                    title="Recompute semantic edges from current vault"
                  >
                    <RotateCcw size={11} />
                  </button>
                </div>
              )}
              {edgesRecomputing && (
                <span className="text-[10px] tabular-nums text-text-muted ml-1">
                  {edgesProgress
                    ? `${edgesProgress.done} / ${edgesProgress.total}`
                    : 'starting…'}
                </span>
              )}
            </>
          )}

          <span className="w-px h-4 bg-border mx-1" />
          <button
            onClick={() =>
              setTransform((t) => ({ ...t, k: Math.min(5, t.k * 1.2) }))
            }
            className="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary"
            title="Zoom in"
          >
            <ZoomIn size={14} />
          </button>
          <button
            onClick={() =>
              setTransform((t) => ({ ...t, k: Math.max(0.2, t.k / 1.2) }))
            }
            className="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary"
            title="Zoom out"
          >
            <ZoomOut size={14} />
          </button>
          <button
            onClick={fit}
            className="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary"
            title="Fit to screen"
          >
            <Maximize2 size={14} />
          </button>
          <button
            onClick={() => {
              setTransform({ x: 0, y: 0, k: 1 });
              simRef.current?.alpha(1).restart();
            }}
            className="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary"
            title="Reset"
          >
            <RotateCcw size={14} />
          </button>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary ml-1"
            title="Close (Esc)"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      <div className="flex-1 relative overflow-hidden">
        {error && (
          <div className="absolute inset-0 flex items-center justify-center text-error text-sm">
            {error}
          </div>
        )}
        {!data && !error && (
          <div className="absolute inset-0 flex items-center justify-center text-text-muted text-sm">
            Building graph…
          </div>
        )}

        <svg
          ref={svgRef}
          className="w-full h-full select-none"
          onWheel={onWheel}
          onMouseDown={onBgMouseDown}
          style={{ cursor: panState.current ? 'grabbing' : 'grab' }}
        >
          <defs>
            {/* Soft glow used by wiki edges so they read as "alive" connections. */}
            <filter id="wiki-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="1.6" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
            {/* Three explicit layers so wiki edges sit above the structural
                hyphae but still below the nodes. */}
            <g>
              {links
                .filter(
                  (l) =>
                    l.kind === 'contain' ||
                    l.kind === 'external' ||
                    l.kind === 'tag',
                )
                .map((l, i) => renderLink(l, i))}
            </g>
            <g>
              {links
                .filter((l) => l.kind === 'wiki')
                .map((l, i) => renderLink(l, i))}
            </g>
            <g>
              {/* Semantic edges sit between wiki edges and nodes:
                  above the explicit links (per spec) but below the
                  node circles so a node always wins a click. The
                  dashed + low-opacity styling keeps them from
                  outshouting the glowy wiki layer. */}
              {links
                .filter((l) => l.kind === 'semantic')
                .map((l, i) => renderLink(l, i))}
            </g>
            <g>{nodes.map((n) => renderNode(n))}</g>
          </g>
        </svg>

        {/* Legend */}
        <div className="absolute bottom-3 left-3 flex flex-col gap-1 bg-surface-1/80 backdrop-blur px-3 py-2 rounded-lg border border-border text-[11px] text-text-muted">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-accent" />
            Folder
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-surface-2 border border-text-muted" />
            Note
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-tag" />
            Tag
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-embedding" />
            Domain
          </div>
        </div>

        {tagQuery && (
          <TagSearch tag={tagQuery} onClose={() => setTagQuery(null)} />
        )}

        {/* Hover tooltip */}
        {hover && (
          <div className="absolute top-3 right-3 bg-surface-2 border border-border-strong rounded-lg px-3 py-2 text-xs shadow-glow max-w-xs">
            <div className="text-text-primary font-medium truncate">{hover.label}</div>
            <div className="text-text-muted mt-0.5">
              {hover.kind === 'note'
                ? hover.id.replace(/^note:/, '')
                : hover.kind === 'domain'
                  ? `domain · ${hover.count} link${hover.count === 1 ? '' : 's'}`
                  : hover.kind === 'tag'
                    ? `tag · ${hover.count} note${hover.count === 1 ? '' : 's'}`
                    : 'folder'}
            </div>
            <div className="text-text-muted mt-1 text-[10px]">
              {hover.kind === 'note'
                ? 'double-click to open'
                : hover.kind === 'domain'
                  ? 'double-click to open in browser'
                  : hover.kind === 'tag'
                    ? 'double-click to search notes'
                    : 'drag to move'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
