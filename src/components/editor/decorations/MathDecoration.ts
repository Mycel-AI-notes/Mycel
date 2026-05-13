/**
 * CodeMirror plugin that swaps `$…$` and `$$…$$` math spans with
 * KaTeX-rendered widgets. Block math is a block widget, so the whole
 * thing lives in a StateField (CodeMirror disallows block decorations
 * from plain ViewPlugins).
 */
import {
  Decoration,
  DecorationSet,
  EditorView,
  WidgetType,
} from '@codemirror/view';
import {
  EditorState,
  EditorSelection,
  RangeSet,
  RangeSetBuilder,
  StateField,
} from '@codemirror/state';
import { parseMathRanges, type MathRange } from '@/lib/math';
import { renderKatex } from '../math/katex-render';

class MathWidget extends WidgetType {
  constructor(
    public readonly body: string,
    public readonly displayMode: boolean,
    /// Number of newlines in the replaced `$$…$$` range. CM6 uses this to
    /// map screen coordinates back to document positions; without it, clicks
    /// beneath a block math widget land one or more lines off — exactly the
    /// "клик в одно место, курсор падает ниже" bug the DB widget had.
    public readonly replacedLineBreaks: number,
    /// Position to drop the caret on a double-click "edit this math"
    /// gesture — just after the opening `$` / `$$`.
    public readonly innerPos: number,
  ) {
    super();
  }

  eq(other: MathWidget): boolean {
    return (
      this.body === other.body &&
      this.displayMode === other.displayMode &&
      this.replacedLineBreaks === other.replacedLineBreaks &&
      this.innerPos === other.innerPos
    );
  }

  // Inline math is roughly one line tall; block math averages ~60px when
  // KaTeX is rendering a standard formula. These are estimates — CM6 only
  // uses them before measurement to avoid laying out at 0px height.
  get estimatedHeight() {
    return this.displayMode ? 60 : 22;
  }

  get lineBreaks() {
    return this.replacedLineBreaks;
  }

  toDOM(view: EditorView): HTMLElement {
    const { html, error } = renderKatex(this.body, this.displayMode);
    const el = document.createElement(this.displayMode ? 'div' : 'span');
    el.className = this.displayMode ? 'cm-math-block' : 'cm-math-inline';
    el.setAttribute('aria-label', this.displayMode ? 'math block' : 'inline math');
    el.contentEditable = 'false';
    if (error) {
      el.classList.add('cm-math-error');
      el.title = error;
      el.textContent =
        (this.displayMode ? '$$' : '$') + this.body + (this.displayMode ? '$$' : '$');
    } else {
      el.innerHTML = html;
    }

    // Swallow mousedown so CM never places the caret inside the math
    // range from a stray click. Without this, *any* click on a tall
    // block formula would land the caret somewhere in the source,
    // flip the math from widget → raw `$$…$$` text, push every line
    // below it down by 5–15 rows, and leave the user staring at a
    // caret that has visually "flown away".
    //
    // We deliberately don't preventDefault here — that would block
    // selection / text-drag through the surrounding lines.
    const stop = (e: Event) => e.stopPropagation();
    el.addEventListener('mousedown', stop);
    el.addEventListener('click', stop);

    // Double-click is the explicit "I want to edit this formula"
    // gesture: drop the caret just past the opening delimiter so
    // the StateField re-renders this range as editable source.
    el.addEventListener('dblclick', (e) => {
      e.preventDefault();
      e.stopPropagation();
      view.dispatch({ selection: { anchor: this.innerPos } });
      view.focus();
    });

    el.style.cursor = 'text';
    el.title = 'Double-click to edit';

    return el;
  }

  // Tell CM to ignore events on the widget — combined with the DOM
  // listeners above, single clicks no longer move the caret here.
  ignoreEvent(): boolean {
    return true;
  }
}

function selectionTouches(sel: EditorSelection, r: MathRange): boolean {
  return sel.ranges.some((s) => s.from <= r.to && s.to >= r.from);
}

function rangeLineBreaks(state: EditorState, r: MathRange): number {
  const startLine = state.doc.lineAt(r.from).number;
  const endLine = state.doc.lineAt(r.to).number;
  return Math.max(0, endLine - startLine);
}

function buildMathDecorations(state: EditorState): DecorationSet {
  const ranges = parseMathRanges(state);
  const sel = state.selection;

  const decos: { from: number; to: number; deco: Decoration }[] = [];
  for (const r of ranges) {
    if (selectionTouches(sel, r)) {
      decos.push({
        from: r.from,
        to: r.to,
        deco: Decoration.mark({
          class:
            r.kind === 'block'
              ? 'cm-math-source cm-math-source-block'
              : 'cm-math-source',
        }),
      });
      continue;
    }
    const innerPos = r.from + (r.kind === 'block' ? 2 : 1);
    decos.push({
      from: r.from,
      to: r.to,
      deco: Decoration.replace({
        widget: new MathWidget(
          r.body,
          r.kind === 'block',
          rangeLineBreaks(state, r),
          innerPos,
        ),
        block: r.kind === 'block',
      }),
    });
  }

  decos.sort((a, b) => a.from - b.from || a.to - b.to);
  return Decoration.set(
    decos.map((d) => d.deco.range(d.from, d.to)),
    true,
  );
}

export const mathDecorationField = StateField.define<DecorationSet>({
  create(state) {
    return buildMathDecorations(state);
  },
  update(value, tr) {
    if (tr.docChanged || tr.selection) {
      return buildMathDecorations(tr.state);
    }
    return value;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// Mark rendered math widgets as atomic so the caret skips over them instead
// of stopping at every internal position. Without this, ArrowLeft/Right
// march through each character of the source even though the rendered
// widget visually occupies one slot, which lands the caret in spots that
// don't match what the user sees. We only mark *widget* ranges atomic —
// when the selection is touching the math, the source is shown via mark
// decorations and the caret must stay free.
function buildMathAtomicRanges(state: EditorState): RangeSet<Decoration> {
  const ranges = parseMathRanges(state);
  const sel = state.selection;
  const builder = new RangeSetBuilder<Decoration>();
  for (const r of ranges) {
    if (selectionTouches(sel, r)) continue;
    builder.add(r.from, r.to, Decoration.replace({}));
  }
  return builder.finish();
}

export const mathAtomicRangesField = StateField.define<RangeSet<Decoration>>({
  create(state) {
    return buildMathAtomicRanges(state);
  },
  update(value, tr) {
    if (tr.docChanged || tr.selection) {
      return buildMathAtomicRanges(tr.state);
    }
    return value;
  },
  provide: (f) => EditorView.atomicRanges.of((view) => view.state.field(f) ?? Decoration.none),
});

export const mathDecorationTheme = EditorView.baseTheme({
  '.cm-math-inline': {
    display: 'inline-block',
    verticalAlign: 'baseline',
    color: 'var(--color-text-primary)',
  },
  '.cm-math-block': {
    display: 'block',
    textAlign: 'center',
    // Use padding (not margin) for the visual gap above / below the
    // formula. Margin would land outside the widget's hit-area, so
    // clicks in those 12px would fall through to CodeMirror and get
    // mapped to a position inside the math range — flipping the
    // widget to raw source and making the caret appear to "fly
    // away" exactly as reported. The DB widget had the same bug.
    margin: '0',
    padding: '12px 0',
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
