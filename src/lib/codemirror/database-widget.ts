import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';
import { createRoot, Root } from 'react-dom/client';
import { createElement } from 'react';
import { DatabaseView } from '@/components/database/DatabaseView';
import { parseDbBlock, resolveDbPath } from '@/lib/database/resolve';

export interface DbBlockMatch {
  fenceFrom: number; // start of opening ```
  fenceTo: number; // end of closing ``` line
  contentStart: number;
  contentEnd: number;
  source: string;
  view?: string;
}

const DB_FENCE_OPEN = /^```db\s*$/;
const FENCE_CLOSE = /^```\s*$/;

function findDbBlocks(view: EditorView): DbBlockMatch[] {
  const { doc } = view.state;
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

  toDOM(): HTMLElement {
    const container = document.createElement('div');
    container.className = 'cm-db-widget';
    container.contentEditable = 'false';

    const dbPath = resolveDbPath(this.notePath, this.source);

    const root = createRoot(container);
    this.root = root;
    root.render(createElement(DatabaseView, { dbPath, viewId: this.viewId }));
    return container;
  }

  destroy() {
    // Defer to avoid React warning about unmounting during render
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

function buildDecorations(view: EditorView, notePath: string): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const blocks = findDbBlocks(view);
  const sel = view.state.selection.main;

  for (const b of blocks) {
    const cursorInBlock = sel.from <= b.fenceTo && sel.to >= b.fenceFrom;
    if (cursorInBlock) {
      // Show raw fence so the user can edit it
      continue;
    }
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

export function databaseWidgetPlugin(notePath: string) {
  return ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildDecorations(view, notePath);
      }
      update(update: ViewUpdate) {
        if (update.docChanged || update.selectionSet || update.viewportChanged) {
          this.decorations = buildDecorations(update.view, notePath);
        }
      }
    },
    {
      decorations: (v) => v.decorations,
      provide: (plugin) =>
        EditorView.atomicRanges.of((view) => {
          return view.plugin(plugin)?.decorations ?? Decoration.none;
        }),
    },
  );
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
