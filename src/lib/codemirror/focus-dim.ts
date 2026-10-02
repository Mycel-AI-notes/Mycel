import { Extension, RangeSetBuilder } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';

/**
 * Focus mode's "only the paragraph you're writing is lit": every visible
 * line outside the cursor's paragraph (the run of non-blank lines around
 * it) gets a dimming class. Only the viewport is decorated, so it stays
 * cheap on long notes.
 */
const dim = Decoration.line({ class: 'cm-myc-dim' });

function build(view: EditorView): DecorationSet {
  const { doc, selection } = view.state;
  const head = doc.lineAt(selection.main.head);
  let first = head.number;
  let last = head.number;
  if (head.text.trim() !== '') {
    while (first > 1 && doc.line(first - 1).text.trim() !== '') first--;
    while (last < doc.lines && doc.line(last + 1).text.trim() !== '') last++;
  }

  const builder = new RangeSetBuilder<Decoration>();
  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = doc.lineAt(pos);
      if (line.number < first || line.number > last) builder.add(line.from, line.from, dim);
      pos = line.to + 1;
    }
  }
  return builder.finish();
}

const plugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = build(view);
    }
    update(u: ViewUpdate) {
      if (u.docChanged || u.selectionSet || u.viewportChanged) {
        this.decorations = build(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

const theme = EditorView.baseTheme({
  '.cm-line': { transition: 'opacity 220ms ease' },
  '.cm-line.cm-myc-dim': { opacity: '0.28' },
});

export const focusDim: Extension = [plugin, theme];
