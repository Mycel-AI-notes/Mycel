/**
 * One-shot "re-run filing suggestions as soon as the editor for this path
 * mounts" flags. The MarkdownEditor (and the QuickFilingBar under it) is
 * keyed by note path, so accepting a rename suggestion remounts everything
 * and wipes the bar's state — this survives the hop to the new path.
 */
const pending = new Set<string>();

export function markPendingSuggest(path: string): void {
  pending.add(path);
}

/** Returns true (once) if `path` was marked; clears the flag. */
export function consumePendingSuggest(path: string): boolean {
  return pending.delete(path);
}
