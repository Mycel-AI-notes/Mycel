import {
  EditorView,
  Decoration,
  DecorationSet,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { RangeSetBuilder, EditorSelection } from '@codemirror/state';

// ── Widgets ───────────────────────────────────────────────────────────────────

class WikilinkWidget extends WidgetType {
  constructor(private label: string) { super(); }
  eq(other: WikilinkWidget) { return this.label === other.label; }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-wikilink';
    span.textContent = this.label;
    return span;
  }
  ignoreEvent() { return false; }
}

class CheckboxWidget extends WidgetType {
  constructor(private checked: boolean, private togglePos: number) { super(); }
  eq(other: CheckboxWidget) {
    return this.checked === other.checked && this.togglePos === other.togglePos;
  }
  toDOM(view: EditorView) {
    const el = document.createElement('input');
    el.type = 'checkbox';
    el.checked = this.checked;
    el.className = 'cm-checkbox';
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      view.dispatch({
        changes: { from: this.togglePos, to: this.togglePos + 1, insert: this.checked ? ' ' : 'x' },
      });
    });
    return el;
  }
  ignoreEvent() { return false; }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function cursorOnLine(sel: EditorSelection, lf: number, lt: number): boolean {
  return sel.ranges.some((r) => r.from <= lt && r.to >= lf);
}

function cursorInSpan(sel: EditorSelection, from: number, to: number): boolean {
  return sel.ranges.some((r) => r.from < to && r.to > from);
}

// ── Build ─────────────────────────────────────────────────────────────────────

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { selection: sel, doc } = view.state;

  type LineDeco = { pos: number; deco: Decoration };
  type SpanDeco = { from: number; to: number; deco: Decoration };

  const lineDecos: LineDeco[] = [];
  const spanDecos: SpanDeco[] = [];

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = doc.lineAt(pos);
      const { text, from: lf, to: lt } = line;
      const onLine = cursorOnLine(sel, lf, lt);

      // ── Headings (line deco only, no marker hiding) ───────────────────
      const hm = text.match(/^(#{1,6}) /);
      if (hm) {
        const level = hm[1].length;
        lineDecos.push({ pos: lf, deco: Decoration.line({ class: `cm-md-h cm-md-h${level}` }) });
        pos = lt + 1;
        continue;
      }

      // ── HR (line deco only, no replace/block widget) ─────────────────
      if (/^-{3,}$/.test(text.trim())) {
        lineDecos.push({ pos: lf, deco: Decoration.line({ class: 'cm-md-hr' }) });
        pos = lt + 1;
        continue;
      }

      // ── Blockquote ─────────────────────────────────────────────────────
      if (text.startsWith('>')) {
        lineDecos.push({ pos: lf, deco: Decoration.line({ class: 'cm-md-blockquote' }) });
      }

      // ── Checkbox (inline replace, only off-line) ─────────────────────
      if (!onLine) {
        const cbm = text.match(/^(\s*[-*+] )(\[[ x]\])/i);
        if (cbm) {
          const checked = cbm[2][1].toLowerCase() === 'x';
          const cbFrom = lf + cbm[1].length;
          spanDecos.push({
            from: cbFrom,
            to: cbFrom + 3,
            deco: Decoration.replace({ widget: new CheckboxWidget(checked, cbFrom + 1) }),
          });
        }
      }

      // ── Inline marks (Decoration.mark only — zero cursor impact) ───────────

      for (const m of text.matchAll(/\*\*(.+?)\*\*/g)) {
        spanDecos.push({ from: lf + m.index!, to: lf + m.index! + m[0].length, deco: Decoration.mark({ class: 'cm-md-bold' }) });
      }
      for (const m of text.matchAll(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g)) {
        spanDecos.push({ from: lf + m.index!, to: lf + m.index! + m[0].length, deco: Decoration.mark({ class: 'cm-md-italic' }) });
      }
      for (const m of text.matchAll(/~~(.+?)~~/g)) {
        spanDecos.push({ from: lf + m.index!, to: lf + m.index! + m[0].length, deco: Decoration.mark({ class: 'cm-md-strike' }) });
      }
      for (const m of text.matchAll(/`([^`]+)`/g)) {
        spanDecos.push({ from: lf + m.index!, to: lf + m.index! + m[0].length, deco: Decoration.mark({ class: 'cm-md-code' }) });
      }

      // ── Wikilinks (replace widget, only when cursor outside span) ───────────
      for (const m of text.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)) {
        const mf = lf + m.index!;
        const mt = mf + m[0].length;
        if (!cursorInSpan(sel, mf, mt)) {
          const label = (m[2] ?? m[1]).trim();
          spanDecos.push({ from: mf, to: mt, deco: Decoration.replace({ widget: new WikilinkWidget(label) }) });
        }
      }

      pos = lt + 1;
    }
  }

  spanDecos.sort((a, b) => a.from !== b.from ? a.from - b.from : b.to - a.to);

  const safeSpans: SpanDeco[] = [];
  let replaceEnd = -1;
  for (const s of spanDecos) {
    const isReplace = s.deco.startSide < 0;
    if (isReplace) {
      if (s.from < replaceEnd) continue;
      replaceEnd = s.to;
    }
    safeSpans.push(s);
  }

  let li = 0;
  let si = 0;
  while (li < lineDecos.length || si < safeSpans.length) {
    const nl = li < lineDecos.length ? lineDecos[li] : null;
    const ns = si < safeSpans.length ? safeSpans[si] : null;
    if (nl && (!ns || nl.pos <= ns.from)) {
      builder.add(nl.pos, nl.pos, nl.deco);
      li++;
    } else if (ns) {
      builder.add(ns.from, ns.to, ns.deco);
      si++;
    }
  }

  return builder.finish();
}

// ── Plugin ────────────────────────────────────────────────────────────────────

export const markdownPreviewPlugin = ViewPlugin.fromClass(
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
  { decorations: (v) => v.decorations },
);

// ── Theme ─────────────────────────────────────────────────────────────────────

export const markdownPreviewTheme = EditorView.baseTheme({
  '.cm-content': { padding: '16px 0' },
  '.cm-line': { padding: '0 24px' },

  // Headings: weight + color only, NO font-size change (keeps line height
  // uniform so CodeMirror coordinate mapping stays accurate)
  '.cm-md-h':  { fontWeight: '800', color: 'var(--color-text-primary)' },
  '.cm-md-h2': { fontWeight: '700' },
  '.cm-md-h3': { fontWeight: '600' },
  '.cm-md-h4': { fontWeight: '600', color: 'var(--color-text-secondary)' },
  '.cm-md-h5': { fontWeight: '600', color: 'var(--color-text-muted)' },
  '.cm-md-h6': { fontWeight: '500', color: 'var(--color-text-muted)' },

  '.cm-md-hr': {
    borderTop: '2px solid var(--color-border)',
    color: 'transparent',
    lineHeight: '2px',
    overflow: 'hidden',
    margin: '4px 0',
  },

  '.cm-md-blockquote': {
    borderLeft: '3px solid var(--color-accent)',
    paddingLeft: '12px !important',
    color: 'var(--color-text-muted)',
    fontStyle: 'italic',
  },

  '.cm-md-bold':   { fontWeight: '700' },
  '.cm-md-italic': { fontStyle: 'italic' },
  '.cm-md-strike': { textDecoration: 'line-through', opacity: '0.6' },
  '.cm-md-code': {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '0.875em',
    backgroundColor: 'var(--color-surface-2)',
    borderRadius: '3px',
    padding: '1px 4px',
  },

  '.cm-wikilink': {
    color: 'var(--color-accent)',
    cursor: 'pointer',
    borderBottom: '1px solid color-mix(in srgb, var(--color-accent) 40%, transparent)',
  },

  '.cm-checkbox': {
    cursor: 'pointer',
    accentColor: 'var(--color-accent)',
    width: '14px',
    height: '14px',
    marginRight: '6px',
    verticalAlign: 'middle',
  },
});
