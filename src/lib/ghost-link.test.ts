import { describe, expect, it } from 'vitest';
import { buildTitleIndex, findGhostLink } from './ghost-link';

const index = buildTitleIndex([
  'Machine learning',
  'Machine learning notes',
  'Mycelium',
  'Mycorrhiza',
  'Spore',
  'Ideas',
]);

describe('findGhostLink', () => {
  it('completes a single word to the shortest matching title', () => {
    expect(findGhostLink('I read about myce', index)).toEqual({
      from: 13,
      title: 'Mycelium',
      rest: 'lium',
    });
  });

  it('spans words to reach a multi-word title', () => {
    const m = findGhostLink('notes on machine lea', index);
    expect(m?.title).toBe('Machine learning');
    expect(m?.from).toBe(9);
    expect(m?.rest).toBe('rning');
  });

  it('ignores fragments shorter than the minimum', () => {
    expect(findGhostLink('a myc', index)).toBeNull();
  });

  it('only starts on a word boundary', () => {
    expect(findGhostLink('submyceli', index)).toBeNull();
  });

  it('stays out of unfinished wikilinks and inline code', () => {
    expect(findGhostLink('see [[myce', index)).toBeNull();
    expect(findGhostLink('run `myce', index)).toBeNull();
  });

  it('offers nothing once the whole title is typed', () => {
    expect(findGhostLink('about Mycelium', index)).toBeNull();
  });

  it('needs the cursor at the end of a word', () => {
    expect(findGhostLink('mycel ', index)).toBeNull();
  });

  it('never suggests the note being edited', () => {
    expect(findGhostLink('the myce', index, 'Mycelium')).toBeNull();
  });

  it('skips titles too short to be worth it', () => {
    expect(buildTitleIndex(['Idea', 'Go']).keys).toEqual([]);
  });
});
