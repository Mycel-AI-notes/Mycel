import { describe, expect, it } from 'vitest';
import {
  buildLocalModel,
  clampDepth,
  fitViewBox,
  noteId,
  tagId,
  type LocalGraphData,
} from './local-graph';

const data: LocalGraphData = {
  center: 'a.md',
  notes: [
    { path: 'a.md', title: 'A', folder: '', depth: 0 },
    { path: 'b.md', title: 'B', folder: '', depth: 1 },
    { path: 'c.md', title: 'C', folder: 'x', depth: 2 },
  ],
  wiki_edges: [
    { from: 'a.md', to: 'b.md' },
    { from: 'b.md', to: 'a.md' },
    { from: 'b.md', to: 'c.md' },
    { from: 'c.md', to: 'gone.md' },
  ],
  tags: [{ tag: 'ideas', count: 2 }],
  tag_edges: [
    { from: 'a.md', tag: 'ideas' },
    { from: 'b.md', tag: 'ideas' },
  ],
};

describe('clampDepth', () => {
  it('keeps depth within 1..3', () => {
    expect(clampDepth(0)).toBe(1);
    expect(clampDepth(2)).toBe(2);
    expect(clampDepth(7)).toBe(3);
    expect(clampDepth(2.6)).toBe(3);
    expect(clampDepth(Number.NaN)).toBe(1);
  });
});

describe('buildLocalModel', () => {
  it('pins the centre and sizes nodes by depth', () => {
    const { nodes } = buildLocalModel(data, false);
    const a = nodes.find((n) => n.id === noteId('a.md'))!;
    const b = nodes.find((n) => n.id === noteId('b.md'))!;
    const c = nodes.find((n) => n.id === noteId('c.md'))!;
    expect([a.fx, a.fy]).toEqual([0, 0]);
    expect(b.fx).toBeUndefined();
    expect(a.r).toBeGreaterThan(b.r);
    expect(b.r).toBeGreaterThan(c.r);
    expect(a.target).toBe('a.md');
  });

  it('merges both directions into one link and drops dangling ones', () => {
    const { links } = buildLocalModel(data, false);
    expect(links).toEqual([
      { source: noteId('a.md'), target: noteId('b.md'), kind: 'wiki' },
      { source: noteId('b.md'), target: noteId('c.md'), kind: 'wiki' },
    ]);
  });

  it('adds tag nodes and links only when asked', () => {
    expect(buildLocalModel(data, false).nodes.some((n) => n.kind === 'tag')).toBe(false);
    const { nodes, links } = buildLocalModel(data, true);
    const tag = nodes.find((n) => n.id === tagId('ideas'))!;
    expect(tag.label).toBe('#ideas');
    expect(tag.target).toBe('ideas');
    expect(links.filter((l) => l.kind === 'tag')).toHaveLength(2);
  });

  it('handles an empty neighbourhood', () => {
    expect(buildLocalModel({ ...data, notes: [] }, true)).toEqual({
      nodes: [{ id: tagId('ideas'), kind: 'tag', label: '#ideas', target: 'ideas', depth: Infinity, r: 3.5 + Math.sqrt(2) }],
      links: [],
    });
  });
});

describe('fitViewBox', () => {
  it('centres on the nodes with padding', () => {
    const box = fitViewBox(
      [
        { x: -100, y: 0, r: 10 },
        { x: 100, y: 50, r: 10 },
      ],
      20,
      0,
    );
    expect(box).toEqual({ x: -130, y: -30, w: 260, h: 110 });
  });

  it('never zooms in past the minimum size', () => {
    expect(fitViewBox([{ x: 5, y: 5, r: 2 }], 10, 200)).toEqual({ x: -95, y: -95, w: 200, h: 200 });
  });

  it('falls back to a box around the origin with nothing positioned', () => {
    expect(fitViewBox([{ r: 3 }], 10, 100)).toEqual({ x: -50, y: -50, w: 100, h: 100 });
  });
});
