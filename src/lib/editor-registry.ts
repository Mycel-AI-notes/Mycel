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

/** Replace the editor doc entirely. Used when the on-disk content was
 *  changed by sync (or by the conflict-resolution "Reload" action) and we
 *  need to push the new text into the live CodeMirror view without
 *  unmounting the editor. Returns true if a view was found. */
export function replaceEditorContent(path: string, content: string): boolean {
  const view = views.get(path);
  if (!view) return false;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: content },
  });
  return true;
}
