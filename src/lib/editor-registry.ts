import { EditorView } from '@codemirror/view';

/**
 * Module-level map of mounted Codemirror views keyed by note path. Used by
 * peripheral UI (outline panel, etc.) to drive the editor without needing a
 * React ref drilled through the tree.
 */
const views = new Map<string, EditorView>();

export function registerEditorView(path: string, view: EditorView) {
  views.set(path, view);
}

export function unregisterEditorView(path: string, view: EditorView) {
  // Only unregister if it's still the same view — protects against a stale
  // unmount cleanup wiping a newly mounted instance for the same path.
  if (views.get(path) === view) {
    views.delete(path);
  }
}

export function getEditorView(path: string): EditorView | undefined {
  return views.get(path);
}

/** Move the cursor to the start of `line` (0-based) and scroll it into view. */
export function scrollEditorToLine(path: string, line: number) {
  const view = views.get(path);
  if (!view) return;
  const doc = view.state.doc;
  const lineNum = Math.max(1, Math.min(doc.lines, line + 1));
  const pos = doc.line(lineNum).from;
  view.dispatch({
    selection: { anchor: pos },
    effects: EditorView.scrollIntoView(pos, { y: 'start', yMargin: 16 }),
  });
  view.focus();
}

/** Insert `text` at the current cursor position of `path`'s editor and
 *  move the cursor to the end of the inserted text. Used by the Related
 *  panel's "insert link" button so the user can pin a discovered note
 *  into the current document without leaving the keyboard.
 *  Returns true if a view was found. */
export function insertAtCursor(path: string, text: string): boolean {
  const view = views.get(path);
  if (!view) return false;
  const pos = view.state.selection.main.head;
  view.dispatch({
    changes: { from: pos, insert: text },
    selection: { anchor: pos + text.length },
    scrollIntoView: true,
  });
  view.focus();
  return true;
}

/** Replace the editor doc entirely. Used when the on-disk content was
 *  changed by sync (or by the conflict-resolution "Reload" action) and we
 *  need to push the new text into the live CodeMirror view without
 *  unmounting the editor. Preserves the caret position and scroll offset
 *  (clamped to the new length) so the user doesn't get yanked back to
 *  position 0. Returns true if a view was found. */
export function replaceEditorContent(path: string, content: string): boolean {
  const view = views.get(path);
  if (!view) return false;
  // Skip when nothing actually changed — avoids a needless dispatch that
  // would still fire updateListener and re-mark the tab dirty.
  if (view.state.doc.toString() === content) return true;
  const prevMain = view.state.selection.main;
  const scrollTop = view.scrollDOM.scrollTop;
  const anchor = Math.min(prevMain.anchor, content.length);
  const head = Math.min(prevMain.head, content.length);
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: content },
    selection: { anchor, head },
    // We're restoring scroll manually below — don't let CM auto-scroll the
    // (possibly relocated) selection into view.
    scrollIntoView: false,
  });
  view.scrollDOM.scrollTop = scrollTop;
  return true;
}
