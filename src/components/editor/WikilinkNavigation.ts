import { EditorView } from '@codemirror/view';
import { invoke } from '@tauri-apps/api/core';

interface NoteSummary {
  path: string;
  title: string;
}

async function resolveWikilink(target: string): Promise<string | null> {
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
    click(event, _view) {
      // Only navigate when clicking the rendered widget, not raw [[...]] text.
      const target = event.target as HTMLElement;
      if (!target.classList.contains('cm-wikilink')) return false;

      const label = target.textContent?.trim() ?? '';
      if (!label) return false;

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
