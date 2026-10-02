import type { Tab } from '@/types';

/**
 * Tab-strip bookkeeping, shared by every "open something in a tab" action.
 *
 * `openNote`, `openGardenTab`, `openInsightsTab` and `openImageTab` each
 * carried their own copy of this ~40-line block. Four copies of the same rules
 * is four places to fix anything wrong with them, and one of them was already
 * wrong: `openNote` captured `openTabs` before awaiting `note_read`, then used
 * an index derived from that stale array to pick which entry of the *fresh*
 * array to replace. If a tab opened during the read, it replaced the wrong one.
 *
 * Keeping the rules pure and index-free removes that whole class of mistake.
 */

/** Preview/pin semantics: single click previews, the next preview replaces it. */
export function upsertTab(
  tabs: Tab[],
  entry: { path: string; title: string },
  preview: boolean,
): Tab[] {
  const existing = tabs.find((t) => t.path === entry.path);

  if (existing) {
    // Re-opening a preview tab deliberately (double click, save) pins it.
    // Anything else leaves the tab exactly as it is — in particular it keeps
    // the title and the dirty flag, which the caller does not know about.
    if (existing.isPreview && !preview) {
      return tabs.map((t) =>
        t.path === entry.path ? { ...t, isPreview: false } : t,
      );
    }
    return tabs;
  }

  const next: Tab = {
    path: entry.path,
    title: entry.title,
    isDirty: false,
    isPreview: preview,
  };

  if (!preview) return [...tabs, next];

  // One preview slot: the new preview takes over the old one's position, so
  // browsing a folder does not pile up junk tabs.
  const idx = tabs.findIndex((t) => t.isPreview);
  if (idx < 0) return [...tabs, next];
  return tabs.map((t, i) => (i === idx ? next : t));
}
