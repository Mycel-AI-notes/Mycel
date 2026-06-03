import { EditorView } from '@codemirror/view';
import { invoke } from '@tauri-apps/api/core';

interface NoteSummary {
  path: string;
  title: string;
}

export async function resolveWikilink(target: string): Promise<string | null> {
  const stem = target.trim().toLowerCase();
  try {
    const notes = await invoke<NoteSummary[]>('notes_list');
    const byFilename = notes.find(
      (n) => n.path.split('/').pop()?.replace(/\.md$/, '').toLowerCase() === stem,
    );
    if (byFilename) return byFilename.path;
    const byTitle = notes.find((n) => n.title.toLowerCase() === stem);
    if (byTitle) return byTitle.path;
    const bySuffix = notes.find((n) =>
      n.path.toLowerCase().replace(/\.md$/, '').endsWith('/' + stem),
    );
    if (bySuffix) return bySuffix.path;
    return null;
  } catch {
    return null;
  }
}

export function makeWikilinkClickHandler(
  openNote: (path: string) => Promise<void>,
  createNote: (path: string) => Promise<void>,
) {
  return EditorView.domEventHandlers({
    // Handle on mousedown, not click: a click moves the caret into the link
    // span first, which makes the live-preview plugin swap the rendered widget
    // back to raw `[[...]]` text before the click handler ever runs. Acting on
    // mousedown keeps the widget in place and stops the caret from jumping in.
    mousedown(event, _view) {
      // Only follow a plain left click; leave modified clicks for editing.
      if (
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        event.shiftKey
      ) {
        return false;
      }
      // Only navigate when clicking the rendered widget, not raw [[...]] text.
      const el = (event.target as HTMLElement | null)?.closest?.(
        '.cm-wikilink',
      ) as HTMLElement | null;
      if (!el) return false;

      const label = el.textContent?.trim() ?? '';
      if (!label) return false;

      event.preventDefault();
      void resolveWikilink(label).then((resolved) => {
        if (resolved) {
          void openNote(resolved);
        } else {
          void createNote(`${label}.md`);
        }
      });
      return true;
    },
  });
}
