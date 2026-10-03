import { Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import {
  EditorSelection,
  EditorState,
  StateEffect,
  StateField,
} from '@codemirror/state';
import { createElement } from 'react';
import { createRoot, Root } from 'react-dom/client';
import { PageHeader } from '@/components/page/PageHeader';
import {
  findFrontmatter,
  frontmatterChange,
  type FrontmatterMutation,
} from '@/lib/page-meta';

/**
 * The page header (icon + properties) as a block widget at the top of the
 * note. When the note has frontmatter the widget *replaces* it, so the YAML
 * is edited through the header; the "YAML" button flips back to the raw
 * source for anything the header can't express.
 */

/** Toggle between the header and the raw frontmatter source. */
export const setRawFrontmatter = StateEffect.define<boolean>();

const rawField = StateField.define<boolean>({
  create: () => false,
  update(raw, tr) {
    for (const e of tr.effects) if (e.is(setRawFrontmatter)) return e.value;
    return raw;
  },
});

const roots = new WeakMap<HTMLElement, Root>();

class PageHeaderWidget extends WidgetType {
  constructor(
    readonly yaml: string | null,
    readonly raw: boolean,
    /** Newlines inside the replaced range — CM needs this to map clicks
     *  below the widget to the right line (see database-widget.ts). */
    readonly replacedLineBreaks: number,
  ) {
    super();
  }

  eq(other: PageHeaderWidget) {
    return (
      this.yaml === other.yaml &&
      this.raw === other.raw &&
      this.replacedLineBreaks === other.replacedLineBreaks
    );
  }

  get lineBreaks() {
    return this.replacedLineBreaks;
  }

  get estimatedHeight() {
    return this.yaml === null || this.raw ? 32 : 160;
  }

  private render(root: Root, view: EditorView) {
    if (this.raw) {
      root.render(
        createElement(
          'div',
          { className: 'myc-page-header is-raw' },
          createElement(
            'button',
            {
              className: 'myc-page-header-btn',
              onClick: () => view.dispatch({ effects: setRawFrontmatter.of(false) }),
            },
            'Done editing YAML',
          ),
        ),
      );
      return;
    }
    const apply = (mutation: FrontmatterMutation) => {
      const change = frontmatterChange(view.state.doc.toString(), mutation);
      if (change) view.dispatch({ changes: change, userEvent: 'input.properties' });
    };
    root.render(
      createElement(PageHeader, {
        yaml: this.yaml,
        apply,
        onEditSource: () => view.dispatch({ effects: setRawFrontmatter.of(true) }),
      }),
    );
  }

  toDOM(view: EditorView): HTMLElement {
    const container = document.createElement('div');
    container.className = 'cm-page-header-widget';
    container.contentEditable = 'false';
    // Keep CM from turning clicks in the header into a caret inside the
    // replaced frontmatter (same trick as the database widget).
    const stop = (e: Event) => e.stopPropagation();
    container.addEventListener('mousedown', stop);
    container.addEventListener('mouseup', stop);
    container.addEventListener('click', stop);

    const root = createRoot(container);
    roots.set(container, root);
    this.render(root, view);
    return container;
  }

  /** Re-render in place so open popovers and focus survive a property edit. */
  updateDOM(dom: HTMLElement, view: EditorView): boolean {
    const root = roots.get(dom);
    if (!root) return false;
    this.render(root, view);
    return true;
  }

  destroy(dom: HTMLElement) {
    const root = roots.get(dom);
    if (!root) return;
    roots.delete(dom);
    queueMicrotask(() => root.unmount());
  }

  ignoreEvent() {
    return true;
  }
}

function build(state: EditorState): DecorationSet {
  const text = state.doc.toString();
  const fm = findFrontmatter(text);
  const raw = state.field(rawField);
  if (fm && !raw) {
    const lineBreaks = state.doc.lineAt(fm.to).number - 1;
    return Decoration.set([
      Decoration.replace({
        widget: new PageHeaderWidget(fm.yaml, false, lineBreaks),
        block: true,
      }).range(0, fm.to),
    ]);
  }
  return Decoration.set([
    Decoration.widget({
      widget: new PageHeaderWidget(null, raw && fm !== null, 0),
      block: true,
      side: -1,
    }).range(0),
  ]);
}

const decoField = StateField.define<DecorationSet>({
  create: build,
  update(deco, tr) {
    if (tr.docChanged || tr.effects.some((e) => e.is(setRawFrontmatter))) return build(tr.state);
    return deco;
  },
  provide: (f) => [
    EditorView.decorations.from(f),
    EditorView.atomicRanges.of((view) => view.state.field(f, false) ?? Decoration.none),
  ],
});

/** First position after the frontmatter, or null when there is none or it
 *  is being edited as source. */
export function bodyStart(state: EditorState): number | null {
  if (state.field(rawField, false)) return null;
  const fm = findFrontmatter(state.doc.sliceString(0, Math.min(state.doc.length, 20000)));
  if (!fm) return null;
  return Math.min(fm.to + 1, state.doc.length);
}

/**
 * A caret at either edge of the hidden frontmatter would type straight into
 * the YAML fences (before `---`, or onto the closing `---` line). Move it to
 * the first body line instead. Ranged selections (Select All) are left alone.
 */
const keepCaretOutOfFrontmatter = EditorState.transactionFilter.of((tr) => {
  if (!tr.selection) return tr;
  const start = bodyStart(tr.state);
  if (start === null) return tr;
  const sel = tr.state.selection;
  if (!sel.ranges.every((r) => r.empty && r.head < start)) return tr;
  return [tr, { selection: EditorSelection.cursor(start), sequential: true }];
});

export const pageHeaderExtension = [rawField, decoField, keepCaretOutOfFrontmatter];

export const pageHeaderTheme = EditorView.baseTheme({
  '.cm-page-header-widget': {
    padding: '0',
    margin: '0',
  },
});
