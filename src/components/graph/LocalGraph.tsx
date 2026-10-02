import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { clsx } from 'clsx';
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type Simulation,
} from 'd3-force';
import { Hash, Loader2, X } from 'lucide-react';
import { useVaultStore } from '@/stores/vault';
import { useUIStore } from '@/stores/ui';
import { TagSearch } from '@/components/search/TagSearch';
import { displayName, isEncryptedPath } from '@/lib/note-name';
import {
  MAX_LOCAL_DEPTH,
  buildLocalModel,
  clampDepth,
  fitViewBox,
  type LocalGraphData,
  type LocalLink,
  type LocalNode,
} from '@/lib/local-graph';

/**
 * The neighbourhood of one note — its links and backlinks, out to 1–3 hops —
 * as a small force-directed graph. Used compact in the right panel and large
 * in the "Open local graph" overlay; both follow the active note, so clicking
 * a node opens that note and the graph re-centres on it.
 *
 * Deliberately a separate, much smaller renderer than `GraphView`: no
 * folders, domains or semantic edges, no pan/zoom state — the view box simply
 * fits whatever the simulation settles on, which is what a few dozen nodes in
 * a 200px-wide panel need.
 */
export function LocalGraph({ path, compact }: { path: string; compact: boolean }) {
  const depth = clampDepth(useUIStore((s) => s.localGraphDepth));
  const showTags = useUIStore((s) => s.localGraphTags);
  const setDepth = useUIStore((s) => s.setLocalGraphDepth);
  const setShowTags = useUIStore((s) => s.setLocalGraphTags);
  const openNote = useVaultStore((s) => s.openNote);
  const vaultVersion = useVaultStore((s) => s.vaultVersion);

  const [data, setData] = useState<LocalGraphData | null>(null);
  const [loading, setLoading] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const [tagQuery, setTagQuery] = useState<string | null>(null);
  const [, setTick] = useState(0);
  const simRef = useRef<Simulation<LocalNode, LocalLink> | null>(null);

  // Saves bump `vaultVersion` once per typing pause; the lookup builds the
  // whole graph, so let the vault settle before refetching (as backlinks do).
  const [settledVersion, setSettledVersion] = useState(vaultVersion);
  useEffect(() => {
    if (settledVersion === vaultVersion) return;
    const t = setTimeout(() => setSettledVersion(vaultVersion), 1500);
    return () => clearTimeout(t);
  }, [vaultVersion, settledVersion]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    invoke<LocalGraphData>('graph_local', { path, depth, includeTags: showTags })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((e) => {
        console.error('graph_local failed', e);
        if (!cancelled) setData(null);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [path, depth, showTags, settledVersion]);

  const { nodes, links } = useMemo(
    () => (data ? buildLocalModel(data, showTags) : { nodes: [], links: [] }),
    [data, showTags],
  );

  useEffect(() => {
    if (!nodes.length) return;
    const sim = forceSimulation<LocalNode>(nodes)
      .force(
        'link',
        forceLink<LocalNode, LocalLink>(links)
          .id((n) => n.id)
          .distance((l) => (l.kind === 'tag' ? 28 : 46))
          .strength((l) => (l.kind === 'tag' ? 0.35 : 0.6)),
      )
      .force('charge', forceManyBody<LocalNode>().strength(compact ? -90 : -160))
      .force('collide', forceCollide<LocalNode>().radius((n) => n.r + 4))
      .force('x', forceX<LocalNode>(0).strength(0.05))
      .force('y', forceY<LocalNode>(0).strength(0.05))
      .alphaDecay(0.05);
    simRef.current = sim;
    let raf = 0;
    sim.on('tick', () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => setTick((n) => n + 1));
    });
    return () => {
      sim.stop();
      cancelAnimationFrame(raf);
      simRef.current = null;
    };
  }, [nodes, links, compact]);

  const box = fitViewBox(nodes, compact ? 16 : 40, compact ? 140 : 320);

  const activate = (n: LocalNode) => {
    if (n.kind === 'note') {
      if (n.target !== path) openNote(n.target).catch(console.error);
    } else {
      setTagQuery(n.target);
    }
  };

  // Labels: always for the centre, on hover for everything, and in the large
  // view for the inner ring too — where there is room to read them.
  const showLabel = (n: LocalNode) =>
    n.target === path || hover === n.id || (!compact && n.kind === 'note' && n.depth <= 1);

  const neighbours = data ? data.notes.length - 1 : 0;
  const notInGraph = data && data.notes.length === 0;

  return (
    <div className={clsx('flex flex-col min-h-0', compact ? 'gap-1.5' : 'h-full gap-2')}>
      <div className="flex items-center gap-1 text-[10px] text-text-muted">
        <span className="uppercase tracking-wider mr-0.5">Depth</span>
        {Array.from({ length: MAX_LOCAL_DEPTH }, (_, i) => i + 1).map((d) => (
          <button
            key={d}
            type="button"
            onClick={() => setDepth(d)}
            className={clsx(
              'w-5 h-5 rounded tabular-nums',
              d === depth
                ? 'bg-surface-2 text-text-primary'
                : 'hover:bg-surface-hover hover:text-text-secondary',
            )}
            aria-pressed={d === depth}
            title={`Show notes up to ${d} link${d > 1 ? 's' : ''} away`}
          >
            {d}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setShowTags(!showTags)}
          className={clsx(
            'ml-1 p-1 rounded',
            showTags
              ? 'bg-surface-2 text-tag'
              : 'hover:bg-surface-hover hover:text-text-secondary',
          )}
          aria-pressed={showTags}
          title={showTags ? 'Hide tags' : 'Show tags'}
        >
          <Hash size={11} />
        </button>
        <span className="ml-auto flex items-center gap-1">
          {loading && <Loader2 size={10} className="animate-spin" />}
          {data && !notInGraph && `${neighbours} linked`}
        </span>
      </div>

      {notInGraph ? (
        <p className="text-xs text-text-muted py-4 text-center">
          {isEncryptedPath(path)
            ? 'Encrypted notes are not part of the graph'
            : 'This note is not in the graph yet — save it first'}
        </p>
      ) : (
        <svg
          className={clsx(
            'w-full rounded border border-border bg-surface-0 select-none',
            compact ? 'h-60' : 'flex-1 min-h-0',
          )}
          viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
          preserveAspectRatio="xMidYMid meet"
          role="img"
          aria-label={`Local graph of ${displayName(path)}`}
        >
          {links.map((l, i) => {
            const s = l.source as LocalNode;
            const t = l.target as LocalNode;
            if (s.x === undefined || t.x === undefined) return null;
            const lit = hover !== null && (hover === s.id || hover === t.id);
            return (
              <line
                key={i}
                x1={s.x}
                y1={s.y}
                x2={t.x}
                y2={t.y}
                className={l.kind === 'tag' ? 'stroke-tag' : 'stroke-accent'}
                strokeOpacity={lit ? 0.95 : l.kind === 'tag' ? 0.45 : 0.55}
                strokeWidth={lit ? 1.6 : 1}
                strokeDasharray={l.kind === 'tag' ? '2 3' : undefined}
              />
            );
          })}
          {nodes.map((n) => {
            if (n.x === undefined || n.y === undefined) return null;
            const isCenter = n.kind === 'note' && n.target === path;
            return (
              <g
                key={n.id}
                transform={`translate(${n.x},${n.y})`}
                className="cursor-pointer"
                onMouseEnter={() => setHover(n.id)}
                onMouseLeave={() => setHover((h) => (h === n.id ? null : h))}
                onClick={() => activate(n)}
              >
                <title>{n.kind === 'note' ? `${n.label}\n${n.target}` : n.label}</title>
                {n.kind === 'tag' ? (
                  <circle r={n.r} className="fill-surface-0 stroke-tag" strokeWidth={1.1} />
                ) : (
                  <circle
                    r={n.r}
                    className={clsx(
                      isCenter
                        ? 'fill-accent stroke-accent'
                        : hover === n.id
                          ? 'fill-text-secondary stroke-text-primary'
                          : 'fill-surface-2 stroke-text-muted',
                    )}
                    strokeWidth={1}
                  />
                )}
                {showLabel(n) && (
                  <text
                    y={-n.r - 3}
                    textAnchor="middle"
                    className={clsx(
                      'pointer-events-none',
                      n.kind === 'tag' ? 'fill-tag' : 'fill-text-secondary',
                      isCenter && 'fill-text-primary',
                    )}
                    style={{
                      fontSize: compact ? 8 : 11,
                      fontWeight: isCenter ? 600 : 400,
                      paintOrder: 'stroke',
                    }}
                  >
                    {n.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      )}

      {tagQuery && <TagSearch tag={tagQuery} onClose={() => setTagQuery(null)} />}
    </div>
  );
}

/**
 * The local graph in a large overlay, for the palette's "Open local graph".
 * Follows the active note like the panel tab; Esc or the close button leaves.
 */
export function LocalGraphDialog({ path, onClose }: { path: string; onClose: () => void }) {
  const title = useVaultStore(
    (s) => s.noteCache.get(path)?.parsed.meta.title ?? displayName(path),
  );
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-8"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-full max-w-4xl h-full max-h-[720px] bg-surface-1 border border-border rounded-lg shadow-xl flex flex-col p-3 gap-2">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-medium text-text-primary truncate">
            Local graph · <span className="text-text-secondary">{title}</span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-surface-hover"
            aria-label="Close local graph"
            title="Close (Esc)"
          >
            <X size={14} />
          </button>
        </div>
        <div className="flex-1 min-h-0">
          <LocalGraph path={path} compact={false} />
        </div>
      </div>
    </div>
  );
}
