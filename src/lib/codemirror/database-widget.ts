import {
  Decoration,
  DecorationSet,
  EditorView,
  WidgetType,
} from '@codemirror/view';
import { EditorState, RangeSetBuilder, StateField } from '@codemirror/state';
import { createRoot, Root } from 'react-dom/client';
import { createElement } from 'react';
import { DatabaseView } from '@/components/database/DatabaseView';
import { parseDbBlock, resolveDbPath } from '@/lib/database/resolve';

export interface DbBlockMatch {
  fenceFrom: number;
  fenceTo: number;
  contentStart: number;
  contentEnd: number;
  source: string;
  view?: string;
}

const DB_FENCE_OPEN = /^```db\s*$/;
const FENCE_CLOSE = /^```\s*$/;

function findDbBlocks(state: EditorState): DbBlockMatch[] {
  const doc = state.doc;
  const out: DbBlockMatch[] = [];
  let line = 1;
  while (line <= doc.lines) {
    const l = doc.line(line);
    if (DB_FENCE_OPEN.test(l.text)) {
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
        const content = doc.sliceString(contentStart, Math.max(contentStart, contentEnd));
        const spec = parseDbBlock(content);
        out.push({
          fenceFrom: openFrom,
          fenceTo,
          contentStart,
          contentEnd,
          source: spec.source,
          view: spec.view,
        });
        line = endLine + 1;
        continue;
      }
    }
    line += 1;
  }
  return out;
}

class DatabaseWidget extends WidgetType {
  private root?: Root;
  constructor(
    public readonly source: string,
    public readonly viewId: string | undefined,
    public readonly notePath: string,
  ) {
    super();
  }

  eq(other: DatabaseWidget): boolean {
    return (
      this.source === other.source &&
      this.viewId === other.viewId &&
      this.notePath === other.notePath
    );
  }

  // CM6 uses these to lay out the block before measurement. Without them the
  // editor sees a 0-height widget and throws "No tile at position N" when the
  // user clicks near it.
  get estimatedHeight() {
    return 280;
  }

  get lineBreaks() {
    return 0;
  }

  toDOM(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'cm-db-widget';
    container.contentEditable = 'false';
    container.style.minHeight = '120px';

    // Block CodeMirror from interpreting clicks inside the widget as a cursor
    // movement into the underlying ```db block. Without this, CM6 sets the
    // selection to a position inside the fence range, the StateField sees the
    // cursor inside the block, and the widget collapses back to raw fence.
    const stop = (e: Event) => e.stopPropagation();
    container.addEventListener('mousedown', stop);
    container.addEventListener('mouseup', stop);
    container.addEventListener('click', stop);

    const dbPath = resolveDbPath(this.notePath, this.source);
    const viewId = this.viewId;
    queueMicrotask(() => {
      if (!container.isConnected || this.root) return;
      try {
        const root = createRoot(container);
        this.root = root;
        root.render(createElement(DatabaseView, { dbPath, viewId }));
      } catch (err) {
        console.error('Failed to mount database widget', err);
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

function buildDecorations(state: EditorState, notePath: string): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const blocks = findDbBlocks(state);

  // Always render the widget. Cursor-in-block collapse was confusing: a click
  // on a cell would bubble into CM6, move the selection inside the fence
  // range, and the widget would vanish behind raw ```db. atomicRanges keeps
  // the cursor outside, so there is no need to ever show the raw fence —
  // the fence text is metadata the user manages through the widget itself.
  for (const b of blocks) {
    builder.add(
      b.fenceFrom,
      b.fenceTo,
      Decoration.replace({
        widget: new DatabaseWidget(b.source, b.view, notePath),
        block: true,
      }),
    );
  }

  return builder.finish();
}

// Block decorations cannot live in a ViewPlugin; CodeMirror requires a
// StateField for them. The field also drives atomicRanges so the cursor skips
// past the rendered widget instead of landing inside it.
export function databaseWidgetPlugin(notePath: string) {
  return StateField.define<DecorationSet>({
    create: (state) => buildDecorations(state, notePath),
    update(deco, tr) {
      // Selection alone doesn't affect what we render — only doc edits do.
      if (tr.docChanged) return buildDecorations(tr.state, notePath);
      return deco.map(tr.changes);
    },
    provide: (field) => [
      EditorView.decorations.from(field),
      EditorView.atomicRanges.of((view) => view.state.field(field, false) ?? Decoration.none),
    ],
  });
}

export const databaseWidgetTheme = EditorView.baseTheme({
  '.cm-db-widget': {
    margin: '12px 0',
    border: '1px solid var(--color-border)',
    borderRadius: '6px',
    overflow: 'hidden',
    backgroundColor: 'var(--color-surface-0)',
  },
});
