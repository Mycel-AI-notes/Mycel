import { describe, expect, it } from 'vitest';
import type { Tab } from '@/types';
import { upsertTab } from './tabs';

const tab = (path: string, over: Partial<Tab> = {}): Tab => ({
  path,
  title: path,
  isDirty: false,
  isPreview: false,
  ...over,
});

describe('upsertTab', () => {
  it('appends a pinned tab', () => {
    const out = upsertTab([], { path: 'a.md', title: 'A' }, false);
    expect(out).toEqual([
      { path: 'a.md', title: 'A', isDirty: false, isPreview: false },
    ]);
  });

  it('appends a preview tab when there is no preview slot in use', () => {
    const out = upsertTab([tab('a.md')], { path: 'b.md', title: 'B' }, true);
    expect(out.map((t) => t.path)).toEqual(['a.md', 'b.md']);
    expect(out[1].isPreview).toBe(true);
  });

  it('replaces the existing preview tab in place', () => {
    // Browsing a folder must not pile up tabs, and the new preview takes the
    // old one's position rather than jumping to the end.
    const tabs = [tab('a.md'), tab('preview.md', { isPreview: true }), tab('c.md')];
    const out = upsertTab(tabs, { path: 'new.md', title: 'New' }, true);

    expect(out.map((t) => t.path)).toEqual(['a.md', 'new.md', 'c.md']);
    expect(out.filter((t) => t.isPreview)).toHaveLength(1);
  });

  it('pins an existing preview tab when reopened deliberately', () => {
    const tabs = [tab('a.md', { isPreview: true })];
    const out = upsertTab(tabs, { path: 'a.md', title: 'A' }, false);
    expect(out[0].isPreview).toBe(false);
  });

  it('leaves an already pinned tab untouched', () => {
    const tabs = [tab('a.md', { isDirty: true })];
    const out = upsertTab(tabs, { path: 'a.md', title: 'ignored' }, false);
    expect(out).toBe(tabs);
  });

  it('keeps a reopened tab dirty and keeps its title', () => {
    // The caller passes a title derived from the path; it must not clobber one
    // that came from frontmatter, nor lose unsaved state.
    const tabs = [tab('a.md', { title: 'From frontmatter', isDirty: true, isPreview: true })];
    const out = upsertTab(tabs, { path: 'a.md', title: 'a' }, false);

    expect(out[0].title).toBe('From frontmatter');
    expect(out[0].isDirty).toBe(true);
    expect(out[0].isPreview).toBe(false);
  });

  it('previewing an already open preview tab changes nothing', () => {
    const tabs = [tab('a.md', { isPreview: true })];
    expect(upsertTab(tabs, { path: 'a.md', title: 'A' }, true)).toBe(tabs);
  });

  it('does not disturb other tabs when replacing the preview', () => {
    const dirty = tab('keep.md', { isDirty: true });
    const tabs = [dirty, tab('old.md', { isPreview: true })];
    const out = upsertTab(tabs, { path: 'new.md', title: 'New' }, true);

    expect(out[0]).toBe(dirty);
  });

  it('never leaves two preview tabs', () => {
    let tabs: Tab[] = [];
    for (const p of ['a.md', 'b.md', 'c.md']) {
      tabs = upsertTab(tabs, { path: p, title: p }, true);
    }
    expect(tabs.filter((t) => t.isPreview)).toHaveLength(1);
    // One preview slot, latest wins — each replaced the one before it.
    expect(tabs.map((t) => t.path)).toEqual(['c.md']);
  });
});
