/**
 * Path bookkeeping for renames and moves.
 *
 * Renaming a folder moves every descendant with it. Anything holding a path —
 * an open tab, a cache key — has to move too, or it keeps pointing at a
 * location that no longer exists. That is not merely stale: the save path
 * calls `create_dir_all` on the parent, so a save through a stale path
 * recreates the old folder and splits the note across both.
 */

/**
 * The path `p` ends up at when `oldPath` is renamed to `newPath`, or `null`
 * when `p` is unaffected.
 *
 * Handles the entry itself (`p === oldPath`) and any descendant of it
 * (`p` under `oldPath/`). A prefix that merely shares a name fragment — `docs`
 * vs `docs-archive` — is not a descendant and returns `null`, which is why the
 * separator is part of the comparison.
 */
export function remapPath(
  p: string,
  oldPath: string,
  newPath: string,
): string | null {
  if (p === oldPath) return newPath;
  const prefix = `${oldPath}/`;
  if (p.startsWith(prefix)) return `${newPath}/${p.slice(prefix.length)}`;
  return null;
}

/** True when `p` is `oldPath` or lives beneath it. */
export function isAtOrUnder(p: string, oldPath: string): boolean {
  return p === oldPath || p.startsWith(`${oldPath}/`);
}
