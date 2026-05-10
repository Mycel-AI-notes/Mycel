import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
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
import { X, ZoomIn, ZoomOut, Maximize2, RotateCcw } from 'lucide-react';
import { useVaultStore } from '@/stores/vault';
import { openUrl } from '@tauri-apps/plugin-opener';

// ── Wire types matching the Rust `graph_data` payload ───────────────────────

interface GraphNote { path: string; title: string; folder: string; }
interface GraphFolder { path: string; name: string; parent: string | null; }
interface GraphDomain { domain: string; count: number; }
interface WikiEdge { from: string; to: string; }
interface ExternalEdge { from: string; domain: string; count: number; }
interface GraphData {
  notes: GraphNote[];
  folders: GraphFolder[];
  domains: GraphDomain[];
  wiki_edges: WikiEdge[];
  external_edges: ExternalEdge[];
}

// ── Internal simulation types ───────────────────────────────────────────────

type NodeKind = 'folder' | 'note' | 'domain';

interface SimNode {
  id: string;
  kind: NodeKind;
  label: string;
  /** For notes: parent folder path. For folders: parent folder. For domains: '__external__'. */
  group: string;
  /** Display radius. */
  r: number;
  /** Domain count → external-edge sizing. */
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
  kind: 'contain' | 'wiki' | 'external';
  /** Edge strength scaler (1 for normal, used for domain counts). */
  weight?: number;
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
  const [transform, setTransform] = useState({ x: 0, y: 0, k: 1 });
  const [, force] = useState(0); // tick re-render trigger
  const { openNote } = useVaultStore();

  // ── Fetch ────────────────────────────────────────────────────────────────
  useEffect(() => {
    invoke<GraphData>('graph_data')
      .then(setData)
      .catch((e) => setError(String(e)));
  }, []);

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

    // Folder nodes. Root ('') is implicit; sized by descendant count later.
    const folderNoteCount = new Map<string, number>();
    for (const n of data.notes) {
      folderNoteCount.set(n.folder, (folderNoteCount.get(n.folder) ?? 0) + 1);
    }
    for (const f of data.folders) {
      const noteCount = folderNoteCount.get(f.path) ?? 0;
      // Skip root if it's empty AND has no children folders.
      if (f.path === '' && noteCount === 0 && data.folders.length === 1) continue;
      nodes.push({
        id: `folder:${f.path}`,
        kind: 'folder',
        label: f.path === '' ? 'vault' : f.name,
        group: f.parent ?? '',
        r: 9 + Math.min(8, Math.sqrt(noteCount) * 2.4),
      });
    }

    // Folder→subfolder containment edges.
    for (const f of data.folders) {
      if (f.parent === null) continue;
      // Both endpoints must exist as nodes.
      links.push({
        source: `folder:${f.parent}`,
        target: `folder:${f.path}`,
        kind: 'contain',
      });
    }

    // Note nodes + folder→note edges.
    for (const n of data.notes) {
      nodes.push({
        id: `note:${n.path}`,
        kind: 'note',
        label: n.title,
        group: n.folder,
        r: 5,
      });
      links.push({
        source: `folder:${n.folder}`,
        target: `note:${n.path}`,
        kind: 'contain',
      });
    }

    // Wiki edges (note↔note).
    for (const e of data.wiki_edges) {
      links.push({
        source: `note:${e.from}`,
        target: `note:${e.to}`,
        kind: 'wiki',
      });
    }

    // External domain super-hub (so all domains float in their own region)
    // and individual domain nodes connected to it.
    if (data.domains.length > 0) {
      nodes.push({
        id: 'folder:__external__',
        kind: 'folder',
        label: 'web',
        group: '',
        r: 11,
      });
      for (const d of data.domains) {
        nodes.push({
          id: `domain:${d.domain}`,
          kind: 'domain',
          label: d.domain,
          group: EXTERNAL_GROUP,
          r: 6 + Math.min(8, Math.sqrt(d.count) * 1.6),
          count: d.count,
        });
        links.push({
          source: 'folder:__external__',
          target: `domain:${d.domain}`,
          kind: 'contain',
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
  }, [data]);

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
            if (l.kind === 'contain') return 38;
            if (l.kind === 'wiki') return 95;
            return 70; // external
          })
          .strength((l) => {
            if (l.kind === 'contain') return 0.9;
            if (l.kind === 'wiki') return 0.35;
            return 0.15;
          }),
      )
      .force('charge', forceManyBody().strength(-180))
      .force(
        'collide',
        forceCollide<SimNode>().radius((d) => d.r + 6),
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
  const renderLink = (l: SimLink, i: number) => {
    const s = l.source as SimNode;
    const t = l.target as SimNode;
    if (!s || !t || s.x === undefined || t.x === undefined) return null;
    const className =
      l.kind === 'wiki'
        ? 'stroke-accent/55'
        : l.kind === 'external'
          ? 'stroke-embedding/40'
          : 'stroke-border-strong/55';
    const dash = l.kind === 'external' ? '3 4' : undefined;
    const width = l.kind === 'wiki' ? 1.4 : l.kind === 'external' ? 1 : 0.8;
    return (
      <line
        key={i}
        x1={s.x}
        y1={s.y}
        x2={t.x}
        y2={t.y}
        strokeWidth={width}
        strokeDasharray={dash}
        className={className}
      />
    );
  };

  const renderNode = (n: SimNode) => {
    if (n.x === undefined || n.y === undefined) return null;
    const isHover = hover?.id === n.id;
    const fill =
      n.kind === 'folder'
        ? 'fill-accent'
        : n.kind === 'domain'
          ? 'fill-embedding'
          : 'fill-surface-2';
    const stroke =
      n.kind === 'folder'
        ? 'stroke-accent'
        : n.kind === 'domain'
          ? 'stroke-embedding'
          : 'stroke-text-muted';

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
            r={n.r + 6}
            className={`${fill} opacity-20`}
            style={{ filter: 'blur(4px)' }}
          />
        )}
        <circle
          r={n.r}
          className={`${fill} ${stroke}`}
          fillOpacity={n.kind === 'note' ? 0.85 : 0.7}
          strokeWidth={n.kind === 'folder' ? 1.5 : 1}
        />
        {n.kind === 'domain' && n.count !== undefined && n.count > 1 && (
          <text
            y={3}
            textAnchor="middle"
            className="fill-text-primary pointer-events-none select-none"
            style={{ fontSize: 9, fontWeight: 600 }}
          >
            {n.count}
          </text>
        )}
        {(isHover || n.kind === 'folder') && (
          <text
            x={n.r + 6}
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
      <div className="flex items-center justify-between px-4 py-2 border-b border-border bg-surface-0 shrink-0">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-medium text-text-primary">Graph</h2>
          {data && (
            <span className="text-xs text-text-muted">
              {data.notes.length} notes · {data.wiki_edges.length} links ·{' '}
              {data.domains.length} domains
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
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
          <g transform={`translate(${transform.x},${transform.y}) scale(${transform.k})`}>
            <g>{links.map((l, i) => renderLink(l, i))}</g>
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
            <span className="inline-block w-2.5 h-2.5 rounded-full bg-embedding" />
            Domain
          </div>
        </div>

        {/* Hover tooltip */}
        {hover && (
          <div className="absolute top-3 right-3 bg-surface-2 border border-border-strong rounded-lg px-3 py-2 text-xs shadow-glow max-w-xs">
            <div className="text-text-primary font-medium truncate">{hover.label}</div>
            <div className="text-text-muted mt-0.5">
              {hover.kind === 'note'
                ? hover.id.replace(/^note:/, '')
                : hover.kind === 'domain'
                  ? `domain · ${hover.count} link${hover.count === 1 ? '' : 's'}`
                  : 'folder'}
            </div>
            <div className="text-text-muted mt-1 text-[10px]">
              {hover.kind === 'note'
                ? 'double-click to open'
                : hover.kind === 'domain'
                  ? 'double-click to open in browser'
                  : 'drag to move'}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
