import type { Heading, WikiLink } from '@/types';

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const HASHTAG_RE = /(?:^|\s)#([\w\-/]+)/g;
const WIKILINK_RE = /(!?)\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

/**
 * Convert each line of the document into a sanitized line for tag/heading
 * extraction: frontmatter and fenced code blocks become empty strings so we
 * don't accidentally pick up `# ` inside YAML or `#tag` inside a code block.
 * Line indices in the returned array correspond 1:1 to the input so callers
 * can report absolute line numbers in the original document.
 */
function sanitizeLines(raw: string): string[] {
  const lines = raw.split(/\r?\n/);
  const out = new Array<string>(lines.length);

  let i = 0;
  // Strip leading YAML frontmatter --- ... ---
  if (lines[0] === '---') {
    out[0] = '';
    i = 1;
    while (i < lines.length && lines[i] !== '---') {
      out[i] = '';
      i++;
    }
    if (i < lines.length) {
      out[i] = '';
      i++;
    }
  }

  let inFence = false;
  let fence = '';
  for (; i < lines.length; i++) {
    const line = lines[i];
    const m = line.match(/^\s*(```+|~~~+)/);
    if (m) {
      if (!inFence) {
        inFence = true;
        fence = m[1];
        out[i] = '';
        continue;
      }
      if (line.trimStart().startsWith(fence)) {
        inFence = false;
        out[i] = '';
        continue;
      }
    }
    out[i] = inFence ? '' : line;
  }
  return out;
}

export function parseHeadings(raw: string): Heading[] {
  const lines = sanitizeLines(raw);
  const headings: Heading[] = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(HEADING_RE);
    if (m) headings.push({ level: m[1].length, text: m[2].trim(), line: i });
  }
  return headings;
}

export function parseHashtags(raw: string): string[] {
  const text = sanitizeLines(raw).join('\n');
  const tags: string[] = [];
  for (const match of text.matchAll(HASHTAG_RE)) {
    tags.push(match[1]);
  }
  return tags;
}

export function parseWikilinks(raw: string): WikiLink[] {
  const text = sanitizeLines(raw).join('\n');
  const links: WikiLink[] = [];
  for (const match of text.matchAll(WIKILINK_RE)) {
    links.push({
      is_embed: match[1] === '!',
      target: match[2].trim(),
      alias: match[3]?.trim(),
    });
  }
  return links;
}

/** Reparse the live-mutable parts of a note (everything but frontmatter meta).
 *  Headings carry absolute line numbers (0-based) in the original document. */
export function reparseBody(content: string) {
  return {
    body: content,
    headings: parseHeadings(content),
    tags: parseHashtags(content),
    wikilinks: parseWikilinks(content),
  };
}
