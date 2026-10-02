import { describe, expect, it } from 'vitest';
import {
  linkCompletionEntries,
  linkTarget,
  resolveNoteTarget,
  wikilinkToNotePath,
} from './wikilink-path';

describe('linkTarget', () => {
  it('returns a plain target unchanged', () => {
    expect(linkTarget('Deep Learning')).toBe('Deep Learning');
  });

  it('drops the display alias', () => {
    // The whole point: the alias is what the reader sees, the target is what
    // we navigate to. Resolving the alias used to create a junk note.
    expect(linkTarget('Deep Learning|my notes')).toBe('Deep Learning');
  });

  it('drops a heading anchor', () => {
    expect(linkTarget('Deep Learning#Priors')).toBe('Deep Learning');
  });

  it('drops an alias and an anchor together', () => {
    expect(linkTarget('Deep Learning#Priors|see this')).toBe('Deep Learning');
  });

  it('trims surrounding whitespace', () => {
    expect(linkTarget('  Notes  |  alias ')).toBe('Notes');
  });
});

describe('wikilinkToNotePath', () => {
  it('appends .md to a bare target', () => {
    expect(wikilinkToNotePath('Roadmap')).toBe('Roadmap.md');
  });

  it('keeps an explicit .md extension', () => {
    expect(wikilinkToNotePath('Roadmap.md')).toBe('Roadmap.md');
  });

  it('allows a subfolder reference', () => {
    expect(wikilinkToNotePath('projects/Roadmap')).toBe('projects/Roadmap.md');
  });

  it('resolves the target, not the alias', () => {
    expect(wikilinkToNotePath('projects/Roadmap|the plan')).toBe(
      'projects/Roadmap.md',
    );
  });

  it('refuses parent-directory traversal', () => {
    // Wikilinks are note content, so on a shared vault this is somebody
    // else's string deciding where we write.
    expect(wikilinkToNotePath('../../../.ssh/authorized_keys')).toBeNull();
    expect(wikilinkToNotePath('a/../../b')).toBeNull();
  });

  it('refuses a single-dot segment', () => {
    expect(wikilinkToNotePath('./secret')).toBeNull();
  });

  it('refuses an absolute path', () => {
    expect(wikilinkToNotePath('/etc/passwd')).toBeNull();
  });

  it('refuses Windows separators and drive letters', () => {
    expect(wikilinkToNotePath('..\\..\\windows\\system32')).toBeNull();
    expect(wikilinkToNotePath('C:/Users/me/notes')).toBeNull();
  });

  it('refuses an empty or whitespace-only target', () => {
    expect(wikilinkToNotePath('')).toBeNull();
    expect(wikilinkToNotePath('   ')).toBeNull();
    expect(wikilinkToNotePath('|only an alias')).toBeNull();
  });

  it('refuses a doubled separator that would produce an empty segment', () => {
    expect(wikilinkToNotePath('a//b')).toBeNull();
  });
});

describe('resolveNoteTarget', () => {
  const notes = [
    { path: 'projects/Roadmap.md', title: 'Roadmap' },
    { path: 'archive/Roadmap.md', title: 'Old roadmap' },
    { path: 'Deep Learning.md', title: 'Neural nets, in depth', aliases: ['DL'] },
    { path: 'ML.md', title: 'ML' },
    { path: 'Machine Learning.md', title: 'Machine Learning', aliases: ['ML', 'Statistical learning'] },
    { path: 'vault/Secret.md.age', title: 'Secret' },
  ];

  it('resolves an exact vault path first', () => {
    expect(resolveNoteTarget(notes, 'archive/Roadmap')).toBe('archive/Roadmap.md');
    expect(resolveNoteTarget(notes, 'archive/roadmap.md')).toBe('archive/Roadmap.md');
  });

  it('resolves a bare basename, ignoring anchor and display text', () => {
    expect(resolveNoteTarget(notes, 'deep learning#Priors|see')).toBe('Deep Learning.md');
  });

  it('resolves by frontmatter title', () => {
    expect(resolveNoteTarget(notes, 'Neural nets, in depth')).toBe('Deep Learning.md');
  });

  it('resolves an encrypted note by its basename', () => {
    expect(resolveNoteTarget(notes, 'Secret')).toBe('vault/Secret.md.age');
  });

  it('resolves through an alias', () => {
    expect(resolveNoteTarget(notes, 'DL')).toBe('Deep Learning.md');
    expect(resolveNoteTarget(notes, 'statistical learning')).toBe('Machine Learning.md');
  });

  it('lets a real note name outrank an alias', () => {
    // `ML.md` exists, so `[[ML]]` goes there even though another note
    // lists `ML` as an alias.
    expect(resolveNoteTarget(notes, 'ML')).toBe('ML.md');
  });

  it('is null for an unknown or empty target', () => {
    expect(resolveNoteTarget(notes, 'Nowhere')).toBeNull();
    expect(resolveNoteTarget(notes, '#heading')).toBeNull();
  });

  it('tolerates notes without an aliases field', () => {
    expect(resolveNoteTarget([{ path: 'a.md', title: 'A' }], 'zzz')).toBeNull();
  });
});

describe('linkCompletionEntries', () => {
  it('offers each note by title and each alias pointing at it', () => {
    const rows = linkCompletionEntries([
      { path: 'Machine Learning.md', title: 'Machine Learning', aliases: ['ML'] },
      { path: 'b.md', title: 'B' },
    ]);
    expect(rows).toEqual([
      { label: 'Machine Learning', apply: 'Machine Learning]]', detail: 'Machine Learning.md' },
      { label: 'ML', apply: 'ML]]', detail: 'alias of Machine Learning', boost: -1 },
      { label: 'B', apply: 'B]]', detail: 'b.md' },
    ]);
  });

  it('every alias row resolves back to its note', () => {
    const notes = [{ path: 'x/Long Name.md', title: 'Long Name', aliases: ['LN', 'Lname'] }];
    for (const row of linkCompletionEntries(notes)) {
      expect(resolveNoteTarget(notes, row.apply.replace(/\]\]$/, ''))).toBe('x/Long Name.md');
    }
  });
});
