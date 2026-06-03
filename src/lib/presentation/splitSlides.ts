/**
 * Slide splitter — turns a note's markdown into an array of slides.
 *
 * A slide boundary is a line consisting solely of three or more dashes
 * (`---`, `----`, …). The splitter is fence-aware so a `---` inside a
 * fenced code block (common in notes *about* YAML / frontmatter) never
 * cuts a slide, and it strips leading YAML frontmatter so the metadata
 * block never becomes a slide of its own.
 *
 * Pure function: no DOM, no store, no disk. The presentation layer feeds
 * it the live editor buffer and renders the result.
 */
export interface Slide {
  index: number; // 0-based
  md: string; // markdown body of the slide
  title: string; // for the overview / table of contents
}

function stripFrontmatter(raw: string): string {
  const fm = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;
  return fm.test(raw) ? raw.replace(fm, '') : raw;
}

function titleOf(md: string, i: number): string {
  const h = md.match(/^#{1,6}\s+(.+?)\s*$/m); // first heading
  if (h) return h[1].trim();
  const line = md.split('\n').find((l) => l.trim());
  return line ? line.trim().slice(0, 60) : `Slide ${i + 1}`;
}

export function splitSlides(raw: string): Slide[] {
  const lines = stripFrontmatter(raw).split(/\r?\n/);
  const chunks: string[] = [];
  let buf: string[] = [];
  let inFence = false;
  let fenceChar = '';
  const isBreak = (l: string) => /^[ \t]*-{3,}[ \t]*$/.test(l);

  for (const line of lines) {
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
      chunks.push(buf.join('\n'));
      buf = [];
    } else {
      buf.push(line);
    }
  }
  chunks.push(buf.join('\n'));

  const slides = chunks
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
    .map((md, i) => ({ index: i, md, title: titleOf(md, i) }));

  // Empty note -> one empty slide, so Play still works.
  return slides.length ? slides : [{ index: 0, md: '', title: 'Slide 1' }];
}
