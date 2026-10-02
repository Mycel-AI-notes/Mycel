import { EditorView } from '@codemirror/view';
import { invoke } from '@tauri-apps/api/core';
import { useVaultStore } from '@/stores/vault';
import { resolveNoteTarget, wikilinkToNotePath, type LinkableNote } from '@/lib/wikilink-path';

type NoteSummary = LinkableNote;

/**
 * `notes_list` walks and parses the whole vault, so calling it per click was
 * a full-vault scan every time the user followed a link. Cache the result and
 * invalidate it on anything that could change the set of notes: `vaultVersion`
 * bumps on every save, and the `fileTree` reference changes on create, rename,
 * delete and refresh.
 */
let notesCache: { notes: NoteSummary[]; version: number; tree: unknown } | null =
  null;

export async function listNotes(): Promise<NoteSummary[]> {
  const { vaultVersion, fileTree } = useVaultStore.getState();
  if (
    notesCache &&
    notesCache.version === vaultVersion &&
    notesCache.tree === fileTree
  ) {
    return notesCache.notes;
  }
  const notes = await invoke<NoteSummary[]>('notes_list');
  notesCache = { notes, version: vaultVersion, tree: fileTree };
  return notes;
}

/** Drop the memoized note list. Exported for tests. */
export function clearWikilinkCache(): void {
  notesCache = null;
}

/** The vault path a wikilink target points at, or `null` when no note
 *  answers to it. Precedence rules live in `resolveNoteTarget`. */
export async function resolveWikilink(target: string): Promise<string | null> {
  try {
    return resolveNoteTarget(await listNotes(), target);
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

      // The widget carries the link destination in `data-target`. Its text is
      // the *alias* for `[[Target|Alias]]`, so resolving that instead would
      // navigate to the wrong note — and create one named after the alias
      // when no such note exists.
      const raw = el.dataset.target ?? el.textContent ?? '';
      const target = raw.trim();
      if (!target) return false;

      event.preventDefault();
      void resolveWikilink(target).then((resolved) => {
        if (resolved) {
          void openNote(resolved);
          return;
        }
        const path = wikilinkToNotePath(target);
        if (!path) {
          console.warn('Refusing to create a note for unsafe wikilink:', target);
          return;
        }
        void createNote(path);
      });
      return true;
    },
  });
}
