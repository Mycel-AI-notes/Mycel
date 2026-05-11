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
import { EditorState, EditorSelection, StateField } from '@codemirror/state';
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
      el.textContent =
        (this.displayMode ? '$$' : '$') + this.body + (this.displayMode ? '$$' : '$');
    } else {
      el.innerHTML = html;
    }
    return el;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function selectionTouches(sel: EditorSelection, r: MathRange): boolean {
  return sel.ranges.some((s) => s.from <= r.to && s.to >= r.from);
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
    decos.push({
      from: r.from,
      to: r.to,
      deco: Decoration.replace({
        widget: new MathWidget(r.body, r.kind === 'block'),
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
