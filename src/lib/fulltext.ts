/**
 * Shapes and pure helpers for full-text search (`search_fulltext`).
 *
 * The backend marks hits inside titles and snippets with two private-use
 * code points rather than HTML, so nothing from a note is ever injected as
 * markup: the UI splits on the markers and renders hit runs as `<mark>`
 * elements, with all text going through React's normal escaping.
 */

/** Opens a highlighted run. Must match `HL_START` in `core/fts/snippet.rs`. */
export const HL_START = '';
/** Closes a highlighted run. Must match `HL_END` in `core/fts/snippet.rs`. */
export const HL_END = '';

export interface FullTextSnippet {
  /** 1-based line in the file, frontmatter included. */
  line: number;
  text: string;
}

export interface FullTextHit {
  path: string;
  title: string;
  title_highlight: string;
  snippets: FullTextSnippet[];
  /** 1-based line of the first body hit; null for title/tag/filter-only. */
  line: number | null;
}

export interface HighlightPart {
  text: string;
  hit: boolean;
}

/**
 * Split marker-annotated text into plain and highlighted runs.
 *
 * Tolerant on purpose: an unmatched marker just toggles state instead of
 * throwing, so a malformed snippet degrades to slightly-off highlighting
 * rather than a blank row. Adjacent runs of the same kind are merged and
 * empty runs dropped.
 */
export function splitHighlight(text: string): HighlightPart[] {
  const parts: HighlightPart[] = [];
  let buf = '';
  let hit = false;
  const flush = () => {
    if (!buf) return;
    const last = parts[parts.length - 1];
    if (last && last.hit === hit) last.text += buf;
    else parts.push({ text: buf, hit });
    buf = '';
  };
  for (const ch of text) {
    if (ch === HL_START) {
      flush();
      hit = true;
    } else if (ch === HL_END) {
      flush();
      hit = false;
    } else {
      buf += ch;
    }
  }
  flush();
  return parts;
}

/** One keyboard-selectable row: a snippet, or the note itself when it has none. */
export interface ResultRow {
  hitIndex: number;
  /** Index into the hit's snippets, or -1 for the note header row. */
  snippetIndex: number;
  path: string;
  /** 1-based line to jump to, or null to open at the top. */
  line: number | null;
}

/**
 * Flatten grouped hits into the rows ↑/↓ walk through. A note with snippets
 * contributes one row per snippet (each jumps to its own line); a note
 * without — matched by title, tag or a filter only — contributes its header.
 */
export function flattenRows(hits: FullTextHit[]): ResultRow[] {
  const rows: ResultRow[] = [];
  hits.forEach((h, hitIndex) => {
    if (h.snippets.length === 0) {
      rows.push({ hitIndex, snippetIndex: -1, path: h.path, line: h.line });
      return;
    }
    h.snippets.forEach((s, snippetIndex) => {
      rows.push({ hitIndex, snippetIndex, path: h.path, line: s.line });
    });
  });
  return rows;
}

/** Operators shown in the panel's help line, in the order they are explained. */
export const QUERY_HELP: ReadonlyArray<{ syntax: string; meaning: string }> = [
  { syntax: '"phrase"', meaning: 'exact' },
  { syntax: '-word', meaning: 'exclude' },
  { syntax: 'a OR b', meaning: 'either' },
  { syntax: 'path:', meaning: 'folder' },
  { syntax: 'file:', meaning: 'name' },
  { syntax: 'tag:', meaning: '#tag' },
];
