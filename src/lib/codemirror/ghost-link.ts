import { Extension, Prec, StateEffect, StateField } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, WidgetType, keymap } from '@codemirror/view';
import { buildTitleIndex, findGhostLink, type TitleIndex } from '@/lib/ghost-link';
import { listNotes } from '@/components/editor/WikilinkNavigation';

/**
 * Editor side of ghost links (see `lib/ghost-link.ts`): the faint rest of a
 * note title after the cursor while typing; Tab links it, Esc dismisses.
 * Only appears on actual typing — moving the cursor clears it.
 */

let index: TitleIndex = buildTitleIndex([]);
let loading = false;

/** Refresh the title index in the background. `listNotes` is memoised on
 *  the vault version, so calling this often is cheap. */
function refreshIndex() {
  if (loading) return;
  loading = true;
  listNotes()
    .then((notes) => {
      index = buildTitleIndex(notes.flatMap((n) => [n.title, ...(n.aliases ?? [])]));
    })
    .catch(() => {
      // Vault not open yet — try again on the next keystroke.
    })
    .finally(() => {
      loading = false;
    });
}

interface Ghost {
  /** Document position where the linked fragment starts. */
  from: number;
  /** Cursor position (end of the typed fragment). */
  to: number;
  title: string;
  rest: string;
}

const dismiss = StateEffect.define<null>();

class GhostWidget extends WidgetType {
  constructor(readonly rest: string) {
    super();
  }
  eq(other: GhostWidget) {
    return other.rest === this.rest;
  }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-ghost-link';
    span.textContent = this.rest;
    const hint = document.createElement('span');
    hint.className = 'cm-ghost-link-hint';
    hint.textContent = 'Tab ⇢ link';
    span.appendChild(hint);
    return span;
  }
  ignoreEvent() {
    return false;
  }
}

function makeField(exclude: () => string | undefined) {
  return StateField.define<Ghost | null>({
    create: () => null,
    update(ghost, tr) {
      if (tr.effects.some((e) => e.is(dismiss))) return null;
      const typed = tr.docChanged && tr.isUserEvent('input.type');
      if (!typed) {
        // Any other change or cursor move clears the suggestion.
        return tr.docChanged || tr.selection ? null : ghost;
      }
      refreshIndex();
      const sel = tr.state.selection.main;
      if (!sel.empty) return null;
      const line = tr.state.doc.lineAt(sel.head);
      // Only at the end of a word: the next character must not continue it.
      const next = tr.state.doc.sliceString(sel.head, sel.head + 1);
      if (/[\p{L}\p{N}]/u.test(next)) return null;
      const before = line.text.slice(0, sel.head - line.from);
      const m = findGhostLink(before, index, exclude());
      if (!m) return null;
      return { from: line.from + m.from, to: sel.head, title: m.title, rest: m.rest };
    },
    provide: (f) =>
      EditorView.decorations.from(f, (ghost): DecorationSet =>
        ghost
          ? Decoration.set([
              Decoration.widget({ widget: new GhostWidget(ghost.rest), side: 1 }).range(ghost.to),
            ])
          : Decoration.none,
      ),
  });
}

const theme = EditorView.baseTheme({
  '.cm-ghost-link': {
    color: 'var(--color-text-muted)',
    opacity: '0.55',
    pointerEvents: 'none',
  },
  '.cm-ghost-link-hint': {
    marginLeft: '0.5em',
    padding: '0 0.35em',
    fontSize: '0.7em',
    borderRadius: '4px',
    border: '1px solid var(--color-border)',
    color: 'var(--color-accent)',
    verticalAlign: 'middle',
  },
});

/**
 * @param currentTitle returns the open note's title, which is never
 *   suggested (a note linking to itself is noise).
 */
export function ghostLinks(currentTitle: () => string | undefined): Extension {
  const field = makeField(currentTitle);
  refreshIndex();
  return [
    field,
    theme,
    Prec.highest(
      keymap.of([
        {
          key: 'Tab',
          run: (view) => {
            const ghost = view.state.field(field, false);
            if (!ghost) return false;
            const insert = `[[${ghost.title}]]`;
            view.dispatch({
              changes: { from: ghost.from, to: ghost.to, insert },
              selection: { anchor: ghost.from + insert.length },
              effects: dismiss.of(null),
              userEvent: 'input.complete',
            });
            return true;
          },
        },
        {
          key: 'Escape',
          run: (view) => {
            if (!view.state.field(field, false)) return false;
            view.dispatch({ effects: dismiss.of(null) });
            return true;
          },
        },
      ]),
    ),
  ];
}
