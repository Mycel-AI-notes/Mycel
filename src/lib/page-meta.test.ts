import { describe, expect, it } from 'vitest';
import {
  coerceValue,
  deleteProp,
  findFrontmatter,
  frontmatterChange,
  inferType,
  pageIconOf,
  readPageMeta,
  renameProp,
  setIcon,
  setProp,
  type TextChange,
} from './page-meta';

function apply(text: string, change: TextChange | null): string {
  if (!change) return text;
  return text.slice(0, change.from) + change.insert + text.slice(change.to);
}

describe('findFrontmatter', () => {
  it('finds a leading block', () => {
    const doc = '---\ntitle: A\n---\nbody';
    const fm = findFrontmatter(doc)!;
    expect(fm.yaml).toBe('title: A\n');
    expect(doc.slice(0, fm.to)).toBe('---\ntitle: A\n---');
  });

  it('ignores an unterminated block and one not on the first line', () => {
    expect(findFrontmatter('---\ntitle: A\nbody')).toBeNull();
    expect(findFrontmatter('text\n---\na: 1\n---\n')).toBeNull();
  });

  it('handles an empty block', () => {
    expect(findFrontmatter('---\n---\nx')!.yaml).toBe('');
  });
});

describe('readPageMeta', () => {
  it('splits icon keys from properties, in order', () => {
    const meta = readPageMeta('icon: sprout\nicon_color: teal\nstatus: Draft\narea: [AI, CV]\ndone: true\n');
    expect(meta.icon).toBe('sprout');
    expect(meta.iconColor).toBe('teal');
    expect(meta.properties).toEqual([
      { key: 'status', value: 'Draft' },
      { key: 'area', value: ['AI', 'CV'] },
      { key: 'done', value: true },
    ]);
  });

  it('keeps dates as strings and empty values as null', () => {
    const meta = readPageMeta('created: 2026-09-13\nnext:\n');
    expect(meta.properties).toEqual([
      { key: 'created', value: '2026-09-13' },
      { key: 'next', value: null },
    ]);
  });

  it('flags YAML it cannot read', () => {
    expect(readPageMeta('a: [unclosed\n').invalid).toBe(true);
  });
});

describe('inferType / coerceValue', () => {
  it('infers from value shape and well-known keys', () => {
    expect(inferType('area', ['a'])).toBe('multi-select');
    expect(inferType('created', '2026-09-13 17:06')).toBe('date');
    expect(inferType('source', 'https://x.dev')).toBe('url');
    expect(inferType('Status', 'Draft')).toBe('select');
    expect(inferType('summary', 'hello')).toBe('text');
  });

  it('coerces between types', () => {
    expect(coerceValue('a, b', 'multi-select')).toEqual(['a', 'b']);
    expect(coerceValue(['a', 'b'], 'select')).toBe('a');
    expect(coerceValue('12', 'number')).toBe(12);
    expect(coerceValue('nope', 'number')).toBeNull();
    expect(coerceValue('yes', 'checkbox')).toBe(true);
  });
});

describe('frontmatterChange', () => {
  it('creates frontmatter on a note without one', () => {
    const out = apply('# Hi\n', frontmatterChange('# Hi\n', setProp('status', 'Draft')));
    expect(out).toBe('---\nstatus: Draft\n---\n# Hi\n');
  });

  it('updates in place and writes lists as flow sequences', () => {
    const doc = '---\ntitle: A\nstatus: Draft\n---\nbody';
    const out = apply(doc, frontmatterChange(doc, setProp('area', ['AI', 'CV'])));
    expect(out).toBe('---\ntitle: A\nstatus: Draft\narea: [AI, CV]\n---\nbody');
  });

  it('writes empty values as a bare key', () => {
    const out = apply('x', frontmatterChange('x', setProp('next', null)));
    expect(out).toBe('---\nnext:\n---\nx');
  });

  it('renames without moving the key', () => {
    const doc = '---\na: 1\nb: 2\nc: 3\n---\n';
    const out = apply(doc, frontmatterChange(doc, renameProp('b', 'beta')));
    expect(out).toBe('---\na: 1\nbeta: 2\nc: 3\n---\n');
  });

  it('removes the block when the last key goes', () => {
    const doc = '---\na: 1\n---\nbody';
    expect(apply(doc, frontmatterChange(doc, deleteProp('a')))).toBe('body');
  });

  it('puts the icon first and clears it again', () => {
    const doc = '---\nstatus: Draft\n---\n';
    const withIcon = apply(doc, frontmatterChange(doc, setIcon('sprout', 'teal')));
    expect(withIcon).toBe('---\nicon: sprout\nicon_color: teal\nstatus: Draft\n---\n');
    expect(pageIconOf(withIcon)).toEqual({ icon: 'sprout', color: 'teal' });
    const cleared = apply(withIcon, frontmatterChange(withIcon, setIcon(null, null)));
    expect(cleared).toBe(doc);
  });

  it('refuses to rewrite YAML it cannot parse', () => {
    const doc = '---\na: [oops\n---\n';
    expect(frontmatterChange(doc, setProp('b', 'x'))).toBeNull();
  });

  it('keeps comments', () => {
    const doc = '---\n# why\na: 1\n---\n';
    const out = apply(doc, frontmatterChange(doc, setProp('a', 2)));
    expect(out).toBe('---\n# why\na: 2\n---\n');
  });
});
