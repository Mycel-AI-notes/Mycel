import { describe, expect, it } from 'vitest';
import { flattenRows, HL_END, HL_START, splitHighlight, type FullTextHit } from './fulltext';

const hl = (s: string) => s.split('[').join(HL_START).split(']').join(HL_END);

describe('splitHighlight', () => {
  it('returns plain text as one run', () => {
    expect(splitHighlight('just text')).toEqual([{ text: 'just text', hit: false }]);
  });

  it('splits marked runs', () => {
    expect(splitHighlight(hl('a [b] c [d]'))).toEqual([
      { text: 'a ', hit: false },
      { text: 'b', hit: true },
      { text: ' c ', hit: false },
      { text: 'd', hit: true },
    ]);
  });

  it('handles Cyrillic and astral characters', () => {
    expect(splitHighlight(hl('Зелёная [ёлка] 🌲'))).toEqual([
      { text: 'Зелёная ', hit: false },
      { text: 'ёлка', hit: true },
      { text: ' 🌲', hit: false },
    ]);
  });

  it('merges adjacent hits and drops empty runs', () => {
    expect(splitHighlight(hl('[a][b][] c'))).toEqual([
      { text: 'ab', hit: true },
      { text: ' c', hit: false },
    ]);
  });

  it('tolerates unbalanced markers', () => {
    // An unclosed start highlights to the end; a stray end is ignored.
    expect(splitHighlight(hl('x [y'))).toEqual([
      { text: 'x ', hit: false },
      { text: 'y', hit: true },
    ]);
    expect(splitHighlight(hl('x] y'))).toEqual([{ text: 'x y', hit: false }]);
  });

  it('never interprets HTML', () => {
    // Text is data, not markup — the parts go to React as strings.
    expect(splitHighlight(hl('<b>[x]</b>'))).toEqual([
      { text: '<b>', hit: false },
      { text: 'x', hit: true },
      { text: '</b>', hit: false },
    ]);
  });

  it('returns nothing for an empty string', () => {
    expect(splitHighlight('')).toEqual([]);
  });
});

describe('flattenRows', () => {
  const hit = (path: string, lines: number[], line: number | null = null): FullTextHit => ({
    path,
    title: path,
    title_highlight: path,
    snippets: lines.map((l) => ({ line: l, text: 'x' })),
    line: lines[0] ?? line,
  });

  it('gives each snippet its own row and line', () => {
    const rows = flattenRows([hit('a.md', [3, 9]), hit('b.md', [1])]);
    expect(rows.map((r) => [r.path, r.snippetIndex, r.line])).toEqual([
      ['a.md', 0, 3],
      ['a.md', 1, 9],
      ['b.md', 0, 1],
    ]);
  });

  it('gives a snippet-less note a header row', () => {
    const rows = flattenRows([hit('title-only.md', [])]);
    expect(rows).toEqual([{ hitIndex: 0, snippetIndex: -1, path: 'title-only.md', line: null }]);
  });

  it('is empty for no hits', () => {
    expect(flattenRows([])).toEqual([]);
  });
});
