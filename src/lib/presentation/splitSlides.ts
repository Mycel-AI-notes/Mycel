/**
 * Slide splitter — turns a note's markdown into an array of slides.
 *
 * A slide boundary is a line consisting solely of three or more dashes
 * (`---`, `----`, …). The splitter is fence-aware so a `---` inside a
 * fenced code block (common in notes *about* YAML / frontmatter) never
 * cuts a slide, and it strips leading YAML frontmatter so the metadata
 * block never becomes a slide of its own.
 *
 * Each slide also carries the 0-based line in the *original* document where
 * its content starts, so the presentation can jump the editor straight to
 * the slide the user is looking at.
 *
 * Pure function: no DOM, no store, no disk. The presentation layer feeds
 * it the live editor buffer and renders the result.
 */
export interface Slide {
  index: number; // 0-based
  md: string; // markdown body of the slide
  title: string; // for the overview / table of contents
  line: number; // 0-based start line in the original document
}

/** Number of leading lines occupied by YAML frontmatter, or 0 if none.
 *  Mirrors the `^---\n … \n---` shape the rest of the app recognises. */
function frontmatterLineCount(lines: string[]): number {
  if (lines[0]?.trim() !== '---') return 0;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') return i + 1;
  }
  return 0; // unterminated — not frontmatter
}

function titleOf(md: string, i: number): string {
  const h = md.match(/^#{1,6}\s+(.+?)\s*$/m); // first heading
  if (h) return h[1].trim();
  const line = md.split('\n').find((l) => l.trim());
  return line ? line.trim().slice(0, 60) : `Slide ${i + 1}`;
}

export function splitSlides(raw: string): Slide[] {
  const lines = raw.split(/\r?\n/);
  const startLine = frontmatterLineCount(lines);

  interface Chunk {
    lines: string[];
    start: number;
  }
  const chunks: Chunk[] = [];
  let buf: string[] = [];
  let bufStart = -1;
  let inFence = false;
  let fenceChar = '';
  const isBreak = (l: string) => /^[ \t]*-{3,}[ \t]*$/.test(l);

  for (let idx = startLine; idx < lines.length; idx++) {
    const line = lines[idx];
    const f = line.match(/^[ \t]*(`{3,}|~{3,})/);
    if (f) {
      const c = f[1][0];
      if (!inFence) {
        inFence = true;
        fenceChar = c;
      } else if (c === fenceChar) {
        inFence = false;
      }
    }
    if (!inFence && isBreak(line)) {
      chunks.push({ lines: buf, start: bufStart });
      buf = [];
      bufStart = -1;
    } else {
      if (bufStart === -1) bufStart = idx;
      buf.push(line);
    }
  }
  chunks.push({ lines: buf, start: bufStart });

  const slides = chunks
    .filter((c) => c.lines.join('\n').trim().length > 0)
    .map((c, i) => {
      // Point at the first non-blank line of the chunk so the editor lands
      // on real content, not the blank line after a separator.
      let off = 0;
      while (off < c.lines.length && c.lines[off].trim() === '') off++;
      const line = (c.start === -1 ? 0 : c.start) + off;
      const md = c.lines.join('\n').trim();
      return { index: i, md, title: titleOf(md, i), line };
    });

  // Empty note -> one empty slide, so Play still works.
  return slides.length
    ? slides
    : [{ index: 0, md: '', title: 'Slide 1', line: 0 }];
}
