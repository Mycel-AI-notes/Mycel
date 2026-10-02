import { describe, expect, it } from 'vitest';
import { fuzzyFilter, fuzzyMatch, fuzzyScore } from './fuzzy';

describe('fuzzyMatch', () => {
  it('matches a scattered subsequence, case-insensitively', () => {
    expect(fuzzyMatch('tgv', 'Toggle graph view')).toBe(true);
    expect(fuzzyMatch('TGV', 'toggle graph view')).toBe(true);
  });

  it('needs the characters in order', () => {
    expect(fuzzyMatch('vgt', 'Toggle graph view')).toBe(false);
  });

  it('an empty query matches everything', () => {
    expect(fuzzyMatch('', 'anything')).toBe(true);
  });
});

describe('fuzzyScore', () => {
  it('ranks prefix over substring over scattered', () => {
    expect(fuzzyScore('tog', 'Toggle')).toBe(100);
    expect(fuzzyScore('gle', 'Toggle')).toBe(50);
    expect(fuzzyScore('tgl', 'Toggle')).toBe(10);
  });
});

describe('fuzzyFilter', () => {
  const items = ['Open settings', 'Toggle graph view', 'Sync now', 'Garden: open Inbox'];

  it('drops non-matches and puts the best match first', () => {
    expect(fuzzyFilter(items, 'open', (s) => s)).toEqual(['Open settings', 'Garden: open Inbox']);
  });

  it('keeps input order among equal scores', () => {
    expect(fuzzyFilter(['b x', 'a x'], 'x', (s) => s)).toEqual(['b x', 'a x']);
  });

  it('returns a copy of everything for a blank query', () => {
    const out = fuzzyFilter(items, '  ', (s) => s);
    expect(out).toEqual(items);
    expect(out).not.toBe(items);
  });
});
