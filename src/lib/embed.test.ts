import { describe, expect, it } from 'vitest';
import { extractEmbedSection, findEmbeds, isImageEmbed, stripFrontmatter } from './embed';

describe('findEmbeds', () => {
  it('finds a note embed with its offsets', () => {
    const text = 'intro\n![[Note]]\n';
    const [e] = findEmbeds(text);
    expect(e).toEqual({ from: 6, to: 15, target: 'Note', anchor: null });
    expect(text.slice(e.from, e.to)).toBe('![[Note]]');
  });

  it('reads the heading anchor and ignores display text', () => {
    expect(findEmbeds('![[Note#Some heading|shown]]')).toMatchObject([
      { target: 'Note', anchor: 'Some heading' },
    ]);
  });

  it('finds several embeds on one line and image embeds', () => {
    const got = findEmbeds('![[a]] and ![[pics/b.png]]').map((e) => e.target);
    expect(got).toEqual(['a', 'pics/b.png']);
  });

  it('ignores plain links', () => {
    expect(findEmbeds('[[Note]] and [x](y)')).toEqual([]);
  });

  it('skips fenced code blocks, including ~~~ fences', () => {
    const text = '```\n![[inside]]\n```\n~~~md\n![[tilde]]\n~~~\n![[outside]]';
    expect(findEmbeds(text).map((e) => e.target)).toEqual(['outside']);
  });

  it('does not let a shorter fence close a longer one', () => {
    const text = '````\n```\n![[still code]]\n````\n![[out]]';
    expect(findEmbeds(text).map((e) => e.target)).toEqual(['out']);
  });

  it('skips inline code spans', () => {
    expect(findEmbeds('use `![[Note]]` to embed, like ![[Real]]').map((e) => e.target)).toEqual([
      'Real',
    ]);
  });

  it('skips table rows', () => {
    expect(findEmbeds('| a | ![[x]] |\n![[y]]').map((e) => e.target)).toEqual(['y']);
  });

  it('an empty anchor counts as none', () => {
    expect(findEmbeds('![[Note#]]')[0].anchor).toBeNull();
  });
});

describe('isImageEmbed', () => {
  it('tells attachments from notes', () => {
    expect(isImageEmbed('pic.PNG')).toBe(true);
    expect(isImageEmbed('attachments/x.webp')).toBe(true);
    expect(isImageEmbed('Note')).toBe(false);
    expect(isImageEmbed('v1.2 release')).toBe(false);
  });
});

describe('stripFrontmatter', () => {
  it('drops a leading YAML block', () => {
    expect(stripFrontmatter('---\naliases: [x]\n---\n# Body\n')).toBe('# Body\n');
  });

  it('leaves a document without one alone, and a later --- rule too', () => {
    expect(stripFrontmatter('# Body\n---\nmore')).toBe('# Body\n---\nmore');
  });
});

describe('extractEmbedSection', () => {
  const note = [
    '---',
    'title: T',
    '---',
    '# Top',
    'intro',
    '## Setup',
    'step one',
    '### Detail',
    'fine print',
    '## Usage',
    'use it',
    '```',
    '# not a heading',
    '```',
    '# Appendix',
    'end',
  ].join('\n');

  it('returns the body without frontmatter when there is no anchor', () => {
    expect(extractEmbedSection(note, null)?.startsWith('# Top')).toBe(true);
  });

  it('cuts a section through its subsections, up to the next sibling', () => {
    expect(extractEmbedSection(note, 'setup')).toBe('## Setup\nstep one\n### Detail\nfine print');
  });

  it('ignores headings inside code blocks', () => {
    expect(extractEmbedSection(note, 'Usage')).toBe(
      '## Usage\nuse it\n```\n# not a heading\n```',
    );
  });

  it('runs to the end for the last section', () => {
    expect(extractEmbedSection(note, 'Appendix')).toBe('# Appendix\nend');
  });

  it('matches a heading with closing hashes', () => {
    expect(extractEmbedSection('## Closed ##\nx\n## Next', 'closed')).toBe('## Closed ##\nx');
  });

  it('is null when the heading does not exist', () => {
    expect(extractEmbedSection(note, 'Missing')).toBeNull();
    expect(extractEmbedSection(note, 'not a heading')).toBeNull();
  });
});
