import {
  Decoration,
  DecorationSet,
  EditorView,
  GutterMarker,
  WidgetType,
  gutterLineClass,
} from '@codemirror/view';
import {
  EditorState,
  RangeSet,
  RangeSetBuilder,
  StateField,
} from '@codemirror/state';
import { createRoot, Root } from 'react-dom/client';
import { createElement } from 'react';
import { EditableTable } from '@/components/table/EditableTable';
import { parseTable, serializeTable, type TableData } from '@/lib/table/serialize';

interface MdTableBlock {
  from: number;
  to: number;
  startLine: number;
  endLine: number;
  raw: string;
}

const SEPARATOR_RE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;
const TABLE_LINE_RE = /\|/;

function findBlocks(state: EditorState): MdTableBlock[] {
  const doc = state.doc;
  const out: MdTableBlock[] = [];
  let n = 1;
  while (n <= doc.lines) {
    if (n + 1 > doc.lines) break;
    const header = doc.line(n);
    if (!TABLE_LINE_RE.test(header.text)) {
      n++;
      continue;
    }
    const sep = doc.line(n + 1);
    if (!SEPARATOR_RE.test(sep.text)) {
      n++;
      continue;
    }
    let endLine = n + 1;
    let m = n + 2;
    while (m <= doc.lines) {
      const l = doc.line(m);
      if (!TABLE_LINE_RE.test(l.text) || l.text.trim() === '') break;
      endLine = m;
      m++;
    }
    const startLine = n;
    const from = header.from;
    const to = doc.line(endLine).to;
    out.push({
      from,
      to,
      startLine,
      endLine,
      raw: doc.sliceString(from, to),
    });
    n = endLine + 1;
  }
  return out;
}

class EditableTableWidget extends WidgetType {
  private root?: Root;
  private currentData: TableData;

  constructor(
    public readonly raw: string,
    /// Number of newlines in the replaced source range. Same role as on the
    /// db-widget: lets CM6 map click coordinates below the widget back to the
    /// correct document line instead of landing one or more lines off.
    public readonly replacedLineBreaks: number,
  ) {
    super();
    this.currentData = parseTable(raw);
  }

  eq(other: EditableTableWidget): boolean {
    return (
      this.raw === other.raw && this.replacedLineBreaks === other.replacedLineBreaks
    );
  }

  get estimatedHeight() {
    const rows = this.currentData.rows.length + 2;
    return 60 + rows * 36;
  }

  get lineBreaks() {
    return this.replacedLineBreaks;
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div');
    container.className = 'cm-md-table-block';
    container.contentEditable = 'false';

    const stop = (e: Event) => e.stopPropagation();
    container.addEventListener('mousedown', stop);
    container.addEventListener('mouseup', stop);
    container.addEventListener('click', stop);

    const findThis = () => {
      const blocks = findBlocks(view.state);
      return blocks.find((b) => b.raw === this.raw);
    };

    const handleChange = (next: TableData) => {
      this.currentData = next;
      const target = findThis();
      if (!target) return;
      const text = serializeTable(next);
      view.dispatch({
        changes: {
          from: target.from,
          to: target.to,
          insert: text,
        },
      });
    };

    const handleRemove = () => {
      const target = findThis();
      if (!target) return;
      const docLen = view.state.doc.length;
      const to = Math.min(docLen, target.to + 1);
      view.dispatch({ changes: { from: target.from, to, insert: '' } });
    };

    const initial = this.currentData;
    queueMicrotask(() => {
      if (!container.isConnected || this.root) return;
      try {
        const root = createRoot(container);
        this.root = root;
        root.render(
          createElement(EditableTable, {
            data: initial,
            onChange: handleChange,
            onRemove: handleRemove,
          }),
        );
      } catch (err) {
        console.error('Failed to mount editable table widget', err);
      }
    });

    return container;
  }

  destroy() {
    if (this.root) {
      const r = this.root;
      this.root = undefined;
      queueMicrotask(() => r.unmount());
    }
  }

  ignoreEvent(): boolean {
    return true;
  }
}

function buildDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const blocks = findBlocks(state);
  for (const b of blocks) {
    const lineBreaks = Math.max(0, b.endLine - b.startLine);
    builder.add(
      b.from,
      b.to,
      Decoration.replace({
        widget: new EditableTableWidget(b.raw, lineBreaks),
        block: true,
      }),
    );
  }
  return builder.finish();
}

const fenceGutterMarker = new (class extends GutterMarker {
  elementClass = 'cm-md-table-fence-gutter';
})();

function buildGutterMarkers(state: EditorState): RangeSet<GutterMarker> {
  const builder = new RangeSetBuilder<GutterMarker>();
  const blocks = findBlocks(state);
  for (const b of blocks) {
    for (let n = b.startLine; n <= b.endLine; n++) {
      const ln = state.doc.line(n);
      builder.add(ln.from, ln.from, fenceGutterMarker);
    }
  }
  return builder.finish();
}

export function editableTableWidgetPlugin() {
  const decorationsField = StateField.define<DecorationSet>({
    create: (state) => buildDecorations(state),
    update(deco, tr) {
      if (tr.docChanged) return buildDecorations(tr.state);
      return deco.map(tr.changes);
    },
    provide: (field) => [
      EditorView.decorations.from(field),
      EditorView.atomicRanges.of(
        (view) => view.state.field(field, false) ?? Decoration.none,
      ),
    ],
  });

  const gutterField = StateField.define<RangeSet<GutterMarker>>({
    create: (state) => buildGutterMarkers(state),
    update(rs, tr) {
      if (tr.docChanged) return buildGutterMarkers(tr.state);
      return rs.map(tr.changes);
    },
    provide: (field) => gutterLineClass.from(field),
  });

  return [decorationsField, gutterField];
}

export const editableTableWidgetTheme = EditorView.baseTheme({
  '.cm-md-table-block': {
    // See the matching comment on .cm-db-widget: outer margin lives outside
    // the widget's hit-area, so clicks in those 12px fall through to CM6 and
    // get mapped to a stale document line. Use inner padding instead, with
    // the visual border / radius / surface on the inner .md-table-root.
    margin: '0',
    padding: '12px 0',
    border: 'none',
    borderRadius: '0',
    backgroundColor: 'transparent',
  },
  '.cm-md-table-block > .md-table-root': {
    border: '1px solid var(--color-border)',
    borderRadius: '6px',
    backgroundColor: 'var(--color-surface-0)',
    overflow: 'hidden',
  },
});
