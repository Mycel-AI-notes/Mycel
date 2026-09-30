import { describe, expect, it } from 'vitest';
import { isAtOrUnder, remapPath } from './path-move';

describe('remapPath', () => {
  it('remaps the renamed entry itself', () => {
    expect(remapPath('notes.md', 'notes.md', 'ideas.md')).toBe('ideas.md');
  });

  it('remaps a direct child of a renamed folder', () => {
    // This is the folder-rename bug: the tab held `old/child.md`, nothing
    // rewrote it, and the next save recreated `old/` via create_dir_all.
    expect(remapPath('old/child.md', 'old', 'new')).toBe('new/child.md');
  });

  it('remaps a deep descendant', () => {
    expect(remapPath('old/a/b/c.md', 'old', 'new')).toBe('new/a/b/c.md');
  });

  it('remaps across a move into another folder', () => {
    expect(remapPath('docs/api.md', 'docs', 'archive/docs')).toBe(
      'archive/docs/api.md',
    );
  });

  it('leaves an unrelated path alone', () => {
    expect(remapPath('other/child.md', 'old', 'new')).toBeNull();
  });

  it('does not treat a shared name prefix as a descendant', () => {
    // `docs-archive` is not inside `docs`; without the separator in the
    // comparison it would be rewritten to `new-archive`.
    expect(remapPath('docs-archive/a.md', 'docs', 'new')).toBeNull();
    expect(remapPath('docsX.md', 'docs', 'new')).toBeNull();
  });

  it('is not confused by the new path sharing the old prefix', () => {
    expect(remapPath('docs/a.md', 'docs', 'docs2')).toBe('docs2/a.md');
  });
});

describe('isAtOrUnder', () => {
  it('matches the entry itself', () => {
    expect(isAtOrUnder('docs', 'docs')).toBe(true);
  });

  it('matches a descendant', () => {
    expect(isAtOrUnder('docs/a/b.md', 'docs')).toBe(true);
  });

  it('rejects a sibling with a shared prefix', () => {
    expect(isAtOrUnder('docs-archive/a.md', 'docs')).toBe(false);
  });

  it('rejects an unrelated path', () => {
    expect(isAtOrUnder('other.md', 'docs')).toBe(false);
  });
});
