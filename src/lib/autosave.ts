import { getEditorView } from './editor-registry';

/**
 * Debounced autosave.
 *
 * Saving used to happen only on `Mod-s` or the Save button, and nothing guarded
 * the gaps: closing a dirty tab dropped the edits without asking, quitting the
 * app took everything unsaved, and `closeTab` left the unsaved text in
 * `noteCache` with `isDirty: false`, so reopening the tab showed text that
 * looked saved and was not.
 *
 * One pending timer per path, so editing two tabs in turn does not cancel the
 * other's save. `flush` exists for the moments a timer is too late to be
 * useful: leaving the tab, unmounting the editor, closing the window.
 */
export const AUTOSAVE_DEBOUNCE_MS = 1200;

type SaveFn = (path: string, content: string) => Promise<void>;

const timers = new Map<string, ReturnType<typeof setTimeout>>();
/** Paths with edits not yet written, whether or not a timer is still pending. */
const pending = new Set<string>();

let save: SaveFn | null = null;

/** Wire in the store's `saveNote`. Called once, from the store module. */
export function configureAutosave(fn: SaveFn) {
  save = fn;
}

function clearTimer(path: string) {
  const t = timers.get(path);
  if (t !== undefined) {
    clearTimeout(t);
    timers.delete(path);
  }
}

/**
 * Note that `path` has unsaved edits and (re)start its timer. Call on every
 * document change.
 */
export function scheduleAutosave(path: string) {
  pending.add(path);
  clearTimer(path);
  timers.set(
    path,
    setTimeout(() => {
      timers.delete(path);
      void runSave(path);
    }, AUTOSAVE_DEBOUNCE_MS),
  );
}

/**
 * Write `path` now if it has pending edits. Resolves once the write has been
 * attempted — a rejected save is reported by the store, which owns the error
 * surface, so failures do not propagate from here.
 */
export async function flushAutosave(path: string): Promise<void> {
  clearTimer(path);
  if (!pending.has(path)) return;
  await runSave(path);
}

/** Write every path with pending edits. Used when the window is closing. */
export async function flushAllAutosaves(): Promise<void> {
  await Promise.all(Array.from(pending).map((p) => flushAutosave(p)));
}

/**
 * Forget any pending state for `path` without writing. For the cases where the
 * file is deliberately no longer there to save to — it was deleted, or trashed.
 */
export function cancelAutosave(path: string) {
  clearTimer(path);
  pending.delete(path);
}

/** Move pending state with a renamed or moved note. */
export function remapAutosave(oldPath: string, newPath: string) {
  if (oldPath === newPath) return;
  clearTimer(oldPath);
  if (pending.delete(oldPath)) pending.add(newPath);
}

export function hasPendingAutosave(path: string): boolean {
  return pending.has(path);
}

async function runSave(path: string) {
  if (!save) return;
  // Read the text from the live editor rather than caching it at schedule
  // time: the user keeps typing while the timer runs, and the last keystroke
  // has to be in the write.
  const view = getEditorView(path);
  if (!view) {
    // The editor unmounted before the timer fired. `flushAutosave` on unmount
    // covers the normal path; if we somehow get here with no view there is no
    // text to trust, so drop it rather than write a stale snapshot.
    pending.delete(path);
    return;
  }
  const content = view.state.doc.toString();
  // Clear first: a keystroke landing during the await should re-arm the timer
  // rather than be swallowed by this save completing.
  pending.delete(path);
  try {
    await save(path, content);
  } catch {
    // The store reports it. Keep the path pending so a later flush retries.
    pending.add(path);
  }
}
