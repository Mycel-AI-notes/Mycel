import { describe, expect, it } from 'vitest';
import { linkTarget, wikilinkToNotePath } from './wikilink-path';

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
