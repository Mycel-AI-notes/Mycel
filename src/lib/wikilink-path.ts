/**
 * Turning a `[[wikilink]]` into a path on disk.
 *
 * Kept free of CodeMirror, React and the Tauri bridge so it can be unit
 * tested directly — this is the boundary where note *content* becomes a file
 * *write*, and on a synced or shared vault that content can come from
 * somebody else.
 */
import { stripNoteExt } from './note-name';

/**
 * Strip a wikilink's display alias and heading anchor, leaving the note
 * reference: both `Target#Heading` and `Target|Alias` reduce to `Target`.
 */
export function linkTarget(raw: string): string {
  const noAlias = raw.split('|')[0] ?? raw;
  return (noAlias.split('#')[0] ?? noAlias).trim();
}

/**
 * The vault-relative path of the note a wikilink would create, or `null` when
 * the target cannot safely become one.
 *
 * Mirrors the backend's `is_safe_rel_path` guard rather than trusting the
 * label: `[[../../../.ssh/authorized_keys]]` must not become a write outside
 * the vault. Legitimate subfolder references like `[[projects/Roadmap]]` pass
 * through untouched.
 */
export function wikilinkToNotePath(raw: string): string | null {
  const target = linkTarget(raw);
  if (!target) return null;
  // Windows separators, drive letters and absolute paths are all out.
  if (target.includes('\\') || target.includes(':') || target.startsWith('/')) {
    return null;
  }
  if (target.split('/').some((s) => s === '' || s === '.' || s === '..')) {
    return null;
  }
  return target.endsWith('.md') ? target : `${target}.md`;
}

/** What `notes_list` reports per note — all link resolution needs. */
export interface LinkableNote {
  path: string;
  title: string;
  /** Frontmatter `aliases`; absent from older backends. */
  aliases?: string[];
}

/**
 * The note a `[[wikilink]]` points at, or `null` when nothing answers to it.
 *
 * Precedence, most specific first, matching the backend's graph and
 * backlinks: exact vault path → basename → frontmatter title → trailing path
 * segments → frontmatter alias. Aliases come last so that adding `aliases:
 * [X]` to one note never steals links from a note actually named `X`.
 * Matching is case-insensitive; an explicit `.md`, a `#heading` and a
 * `|display` part are ignored.
 */
export function resolveNoteTarget(notes: LinkableNote[], raw: string): string | null {
  const key = stripNoteExt(linkTarget(raw)).toLowerCase();
  if (!key) return null;
  const bare = (path: string) => stripNoteExt(path).toLowerCase();

  const byPath = notes.find((n) => bare(n.path) === key);
  if (byPath) return byPath.path;
  const byStem = notes.find((n) => bare(n.path.split('/').pop() ?? n.path) === key);
  if (byStem) return byStem.path;
  const byTitle = notes.find((n) => n.title.toLowerCase() === key);
  if (byTitle) return byTitle.path;
  const bySuffix = notes.find((n) => bare(n.path).endsWith(`/${key}`));
  if (bySuffix) return bySuffix.path;
  const byAlias = notes.find((n) => n.aliases?.some((a) => a.trim().toLowerCase() === key));
  return byAlias?.path ?? null;
}

export interface LinkCompletionEntry {
  label: string;
  /** Text inserted after `[[`, closing brackets included. */
  apply: string;
  detail: string;
  /** Ranks alias rows just below note rows on equal match quality. */
  boost?: number;
}

/**
 * `[[` autocomplete rows: one per note (by title), plus one per frontmatter
 * alias. Picking an alias inserts `[[alias]]`, which `resolveNoteTarget`
 * sends to its note.
 */
export function linkCompletionEntries(notes: LinkableNote[]): LinkCompletionEntry[] {
  const out: LinkCompletionEntry[] = [];
  for (const n of notes) {
    out.push({ label: n.title, apply: `${n.title}]]`, detail: n.path });
    for (const alias of n.aliases ?? []) {
      out.push({ label: alias, apply: `${alias}]]`, detail: `alias of ${n.title}`, boost: -1 });
    }
  }
  return out;
}
