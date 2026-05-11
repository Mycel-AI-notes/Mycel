/**
 * CodeMirror ViewPlugin that swaps `$…$` and `$$…$$` math spans with
 * KaTeX-rendered widgets. The same plugin handles both kinds because
 * they share a single document scan (see `parseMathRanges`) — splitting
 * them would double the work and risk the two scans disagreeing about
 * which `$` belongs to which span.
 */
import {
  Decoration,
  DecorationSet,
  EditorView,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { EditorSelection, RangeSetBuilder } from '@codemirror/state';
import { parseMathRanges, type MathRange } from '@/lib/math';
import { renderKatex } from '../math/katex-render';

class MathWidget extends WidgetType {
  constructor(
    public readonly body: string,
    public readonly displayMode: boolean,
  ) {
    super();
  }

  eq(other: MathWidget): boolean {
    return this.body === other.body && this.displayMode === other.displayMode;
  }

  toDOM(): HTMLElement {
    const { html, error } = renderKatex(this.body, this.displayMode);
    const el = document.createElement(this.displayMode ? 'div' : 'span');
    el.className = this.displayMode ? 'cm-math-block' : 'cm-math-inline';
    el.setAttribute('aria-label', this.displayMode ? 'math block' : 'inline math');
    if (error) {
      el.classList.add('cm-math-error');
      el.title = error;
      // Show the raw source so the user can see what failed without
      // exiting the widget. The error tooltip carries the KaTeX message.
      el.textContent = (this.displayMode ? '$$' : '$') + this.body + (this.displayMode ? '$$' : '$');
    } else {
      el.innerHTML = html;
    }
    return el;
  }

  ignoreEvent(): boolean {
    // Let CodeMirror handle clicks — clicking on the widget should move
    // the caret into the underlying math source so we get a smooth
    // "click to edit" flow.
    return false;
  }
}

function selectionTouches(sel: EditorSelection, r: MathRange): boolean {
  return sel.ranges.some((s) => s.from <= r.to && s.to >= r.from);
}

function buildDecorations(view: EditorView): DecorationSet {
  const ranges = parseMathRanges(view.state);
  const builder = new RangeSetBuilder<Decoration>();
  const sel = view.state.selection;
  // Decorations must be appended in ascending `from`. `parseMathRanges`
  // already yields them in order because it scans the doc linearly.
  for (const r of ranges) {
    if (selectionTouches(sel, r)) {
      // Mark the raw source so the user can see they're "inside" math —
      // monospace + dim background mimics the spec's "raw LaTeX with
      // syntax highlight" without pulling in a full language mode.
      builder.add(
        r.from,
        r.to,
        Decoration.mark({ class: r.kind === 'block' ? 'cm-math-source cm-math-source-block' : 'cm-math-source' }),
      );
      continue;
    }
    builder.add(
      r.from,
      r.to,
      Decoration.replace({
        widget: new MathWidget(r.body, r.kind === 'block'),
        block: r.kind === 'block',
      }),
    );
  }
  return builder.finish();
}

export const mathDecorationPlugin = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;
    constructor(view: EditorView) {
      this.decorations = buildDecorations(view);
    }
    update(update: ViewUpdate) {
      if (update.docChanged || update.selectionSet || update.viewportChanged) {
        this.decorations = buildDecorations(update.view);
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

export const mathDecorationTheme = EditorView.baseTheme({
  '.cm-math-inline': {
    display: 'inline-block',
    verticalAlign: 'baseline',
    color: 'var(--color-text-primary)',
  },
  '.cm-math-block': {
    display: 'block',
    textAlign: 'center',
    margin: '12px 0',
    color: 'var(--color-text-primary)',
  },
  '.cm-math-error': {
    color: 'var(--color-error)',
    textDecoration: 'underline wavy var(--color-error)',
    fontFamily: "'JetBrains Mono', monospace",
    cursor: 'help',
  },
  '.cm-math-source': {
    fontFamily: "'JetBrains Mono', monospace",
    backgroundColor: 'color-mix(in srgb, var(--color-accent) 8%, transparent)',
    borderRadius: '3px',
    padding: '0 2px',
  },
  '.cm-math-source-block': {
    display: 'inline',
  },
  '.katex': { color: 'var(--color-text-primary)' },
  '.katex-display': { margin: '0.5em 0' },
});
