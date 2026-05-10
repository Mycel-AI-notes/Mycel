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
    click(event, view) {
      const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
      if (pos === null) return false;

      const line = view.state.doc.lineAt(pos);
      const text = line.text;
      const col = pos - line.from;

      const wikilinkRe = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;
      let match;
      while ((match = wikilinkRe.exec(text)) !== null) {
        const start = match.index;
        const end = match.index + match[0].length;
        if (col >= start && col <= end) {
          const target = match[1].trim();
          void resolveWikilink(target).then((resolved) => {
            if (resolved) {
              void openNote(resolved);
            } else {
              void createNote(`${target}.md`);
            }
          });
          return true;
        }
      }
      return false;
    },
  });
}
