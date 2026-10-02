/**
 * `![[Note]]` / `![[Note#Heading]]` / `![[pic.png]]` embeds: finding them in
 * a document and cutting out the part of the target note they show.
 *
 * Pure so the parsing rules are tested; the editor widget that renders an
 * embed lives in `components/editor/decorations/EmbedDecoration.ts`.
 */
import { isAttachmentPath } from './note-name';

export interface EmbedMatch {
  /** Offset of the `!` in the scanned text. */
  from: number;
  /** Offset just past the closing `]]`. */
  to: number;
  /** Note or file reference, without anchor or display text. */
  target: string;
  /** Heading after `#`, if any. */
  anchor: string | null;
}

const EMBED_RE = /!\[\[([^\]|\n#]+)(?:#([^\]|\n]*))?(?:\|[^\]\n]*)?\]\]/g;
const FENCE_RE = /^\s*(`{3,}|~{3,})/;

/**
 * Every embed in `text`, skipping fenced code blocks and inline code spans —
 * an embed shown as an example in a code block must stay text — and table
 * rows.
 */
export function findEmbeds(text: string): EmbedMatch[] {
  const out: EmbedMatch[] = [];
  let fence: string | null = null;
  let offset = 0;
  for (const line of text.split('\n')) {
    const lineStart = offset;
    offset += line.length + 1;
    const f = FENCE_RE.exec(line);
    if (f) {
      const marker = f[1];
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
      continue;
    }
    if (fence !== null || !line.includes('![[')) continue;
    // Table rows render as a table widget; a block embed hung off one of
    // their lines would land inside it.
    if (line.trimStart().startsWith('|')) continue;

    const codeSpans: Array<[number, number]> = [];
    for (const m of line.matchAll(/`[^`]*`/g)) {
      codeSpans.push([m.index!, m.index! + m[0].length]);
    }
    for (const m of line.matchAll(EMBED_RE)) {
      const start = m.index!;
      const end = start + m[0].length;
      if (codeSpans.some(([a, b]) => start < b && end > a)) continue;
      const target = m[1].trim();
      if (!target) continue;
      const anchor = m[2]?.trim() || null;
      out.push({ from: lineStart + start, to: lineStart + end, target, anchor });
    }
  }
  return out;
}

/** Is the embed target an image attachment rather than a note? */
export function isImageEmbed(target: string): boolean {
  return isAttachmentPath(target);
}

/** `content` without a leading YAML frontmatter block. */
export function stripFrontmatter(content: string): string {
  const m = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(content);
  return m ? content.slice(m[0].length) : content;
}

const HEADING_RE = /^(#{1,6})\s+(.*?)\s*#*\s*$/;

/**
 * What an embed shows from `content`: the whole body (frontmatter dropped)
 * without an anchor, or the section under the matching heading — from the
 * heading through the line before the next heading of the same or a higher
 * level. Heading match is case-insensitive. `null` when the anchor names no
 * heading, so the caller can say so rather than show the whole note.
 */
export function extractEmbedSection(content: string, anchor: string | null): string | null {
  const body = stripFrontmatter(content);
  if (!anchor) return body;
  const wanted = anchor.trim().toLowerCase();
  const lines = body.split('\n');
  let fence = false;
  let start = -1;
  let level = 0;
  for (let i = 0; i < lines.length; i++) {
    if (FENCE_RE.test(lines[i])) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const h = HEADING_RE.exec(lines[i]);
    if (!h) continue;
    if (start === -1) {
      if (h[2].trim().toLowerCase() === wanted) {
        start = i;
        level = h[1].length;
      }
    } else if (h[1].length <= level) {
      return lines.slice(start, i).join('\n').trimEnd();
    }
  }
  return start === -1 ? null : lines.slice(start).join('\n').trimEnd();
}
