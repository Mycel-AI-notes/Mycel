/**
 * Helpers for note path/name handling. Notes can live on disk as either
 * `*.md` (plaintext) or `*.md.age` (per-note encrypted). The UI should never
 * surface the `.md` or `.md.age` suffix in titles, tabs, or autocomplete —
 * use `displayName()` to strip whichever suffix is present.
 */

export const ENC_SUFFIX = '.md.age';
export const MD_SUFFIX = '.md';

/** Strip `.md` or `.md.age` from a file name / path tail. */
export function stripNoteExt(name: string): string {
  if (name.endsWith(ENC_SUFFIX)) return name.slice(0, -ENC_SUFFIX.length);
  if (name.endsWith(MD_SUFFIX)) return name.slice(0, -MD_SUFFIX.length);
  return name;
}

/** Display title for a note path (the last segment, with the suffix removed). */
export function displayName(path: string): string {
  const tail = path.split('/').pop() ?? path;
  return stripNoteExt(tail);
}

export function isEncryptedPath(path: string): boolean {
  return path.endsWith(ENC_SUFFIX);
}

const ATTACHMENT_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'];

/** True if `path` points at a binary attachment we surface in the
 *  tree but should not try to open as a note. */
export function isAttachmentPath(path: string): boolean {
  const tail = path.split('/').pop() ?? path;
  const ext = tail.split('.').pop()?.toLowerCase();
  return !!ext && ATTACHMENT_EXTS.includes(ext);
}
