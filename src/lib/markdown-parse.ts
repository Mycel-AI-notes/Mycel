import type { Heading, WikiLink } from '@/types';

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const HASHTAG_RE = /(?:^|\s)#([\w\-/]+)/g;
const WIKILINK_RE = /(!?)\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;

/**
 * Split off a YAML frontmatter block at the very top of the document.
 * Returns `[meta-block, body]`; meta-block is empty if there is none.
 */
function splitFrontmatter(raw: string): [string, string] {
  if (!raw.startsWith('---\n') && !raw.startsWith('---\r\n')) return ['', raw];
  const rest = raw.slice(4);
  const end = rest.search(/^---\s*$/m);
  if (end === -1) return ['', raw];
  const meta = rest.slice(0, end);
  // Skip the closing `---` line itself.
  const after = rest.slice(end).replace(/^---\s*\r?\n?/, '');
  return [meta, after];
}

/** Strip fenced ``` ``` and ~~~ code blocks so tags/headings inside are ignored. */
function stripCodeBlocks(text: string): string {
  const lines = text.split(/\r?\n/);
  let inFence = false;
  let fence = '';
  const out: string[] = [];
  for (const line of lines) {
    const m = line.match(/^(\s*)(```+|~~~+)/);
    if (m) {
      if (!inFence) {
        inFence = true;
        fence = m[2];
        out.push('');
        continue;
      }
      if (line.trimStart().startsWith(fence)) {
        inFence = false;
        out.push('');
        continue;
      }
    }
    out.push(inFence ? '' : line);
  }
  return out.join('\n');
}

export function parseHeadings(body: string): Heading[] {
  const cleaned = stripCodeBlocks(body);
  const headings: Heading[] = [];
  for (const line of cleaned.split(/\r?\n/)) {
    const m = line.match(HEADING_RE);
    if (m) {
      headings.push({ level: m[1].length, text: m[2].trim() });
    }
  }
  return headings;
}

export function parseHashtags(body: string): string[] {
  const cleaned = stripCodeBlocks(body);
  const tags: string[] = [];
  for (const match of cleaned.matchAll(HASHTAG_RE)) {
    tags.push(match[1]);
  }
  return tags;
}

export function parseWikilinks(body: string): WikiLink[] {
  const cleaned = stripCodeBlocks(body);
  const links: WikiLink[] = [];
  for (const match of cleaned.matchAll(WIKILINK_RE)) {
    links.push({
      is_embed: match[1] === '!',
      target: match[2].trim(),
      alias: match[3]?.trim(),
    });
  }
  return links;
}

/** Reparse only the live-mutable parts of a note (everything but frontmatter meta). */
export function reparseBody(content: string) {
  const [, body] = splitFrontmatter(content);
  return {
    body,
    headings: parseHeadings(body),
    tags: parseHashtags(body),
    wikilinks: parseWikilinks(body),
  };
}
