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
  fenceFrom: number;
  fenceTo: number;
  contentStart: number;
  contentEnd: number;
  content: string;
}

const FENCE_OPEN = /^```mdtable\s*$/;
const FENCE_CLOSE = /^```\s*$/;

function findBlocks(state: EditorState): MdTableBlock[] {
  const doc = state.doc;
  const out: MdTableBlock[] = [];
  let line = 1;
  while (line <= doc.lines) {
    const l = doc.line(line);
    if (FENCE_OPEN.test(l.text)) {
      const openFrom = l.from;
      const contentStart = l.to + 1;
      let endLine = line + 1;
      let contentEnd = contentStart;
      let fenceTo = l.to;
      let closed = false;
      while (endLine <= doc.lines) {
        const el = doc.line(endLine);
        if (FENCE_CLOSE.test(el.text)) {
          contentEnd = el.from > contentStart ? el.from - 1 : contentStart;
          fenceTo = el.to;
          closed = true;
          break;
        }
        endLine += 1;
      }
      if (closed) {
        const content = doc.sliceString(
          contentStart,
          Math.max(contentStart, contentEnd),
        );
        out.push({
          fenceFrom: openFrom,
          fenceTo,
          contentStart,
          contentEnd,
          content,
        });
        line = endLine + 1;
        continue;
      }
    }
    line += 1;
  }
  return out;
}

class EditableTableWidget extends WidgetType {
  private root?: Root;
  private currentData: TableData;

  constructor(public readonly content: string) {
    super();
    this.currentData = parseTable(content);
  }

  eq(other: EditableTableWidget): boolean {
    return this.content === other.content;
  }

  get estimatedHeight() {
    const rows = this.currentData.rows.length + 2;
    return 60 + rows * 36;
  }

  get lineBreaks() {
    return 0;
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div');
    container.className = 'cm-md-table-block';
    container.contentEditable = 'false';

    // Stop CodeMirror from interpreting clicks inside the widget as cursor
    // moves into the underlying fence range.
    const stop = (e: Event) => e.stopPropagation();
    container.addEventListener('mousedown', stop);
    container.addEventListener('mouseup', stop);
    container.addEventListener('click', stop);

    const findThis = () => {
      const blocks = findBlocks(view.state);
      return blocks.find((b) => b.content === this.content);
    };

    const handleChange = (next: TableData) => {
      this.currentData = next;
      const target = findThis();
      if (!target) return;
      const text = serializeTable(next);
      view.dispatch({
        changes: {
          from: target.contentStart,
          to: target.contentEnd,
          insert: text,
        },
      });
    };

    const handleRemove = () => {
      const target = findThis();
      if (!target) return;
      const docLen = view.state.doc.length;
      const to = Math.min(docLen, target.fenceTo + 1);
      view.dispatch({ changes: { from: target.fenceFrom, to, insert: '' } });
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

  updateDOM(_dom: HTMLElement): boolean {
    if (!this.root) return false;
    // Re-render with the latest parsed data so downstream document edits
    // (undo, external rewrites) propagate into the widget.
    return false;
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
    builder.add(
      b.fenceFrom,
      b.fenceTo,
      Decoration.replace({
        widget: new EditableTableWidget(b.content),
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
    const startLine = state.doc.lineAt(b.fenceFrom);
    const endLine = state.doc.lineAt(b.fenceTo);
    for (let n = startLine.number; n <= endLine.number; n++) {
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
    margin: '12px 0',
    border: '1px solid var(--color-border)',
    borderRadius: '6px',
    backgroundColor: 'var(--color-surface-0)',
    overflow: 'hidden',
  },
});
