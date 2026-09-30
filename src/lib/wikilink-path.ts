/**
 * Turning a `[[wikilink]]` into a path on disk.
 *
 * Kept free of CodeMirror, React and the Tauri bridge so it can be unit
 * tested directly — this is the boundary where note *content* becomes a file
 * *write*, and on a synced or shared vault that content can come from
 * somebody else.
 */

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
