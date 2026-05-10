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

class HrWidget extends WidgetType {
  toDOM() {
    const el = document.createElement('div');
    el.className = 'cm-hr-line';
    return el;
  }
  ignoreEvent() { return false; }
}

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
  constructor(private checked: boolean, private pos: number) { super(); }
  eq(other: CheckboxWidget) { return this.checked === other.checked && this.pos === other.pos; }
  toDOM(view: EditorView) {
    const el = document.createElement('input');
    el.type = 'checkbox';
    el.checked = this.checked;
    el.className = 'cm-checkbox';
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      view.dispatch({ changes: { from: this.pos, to: this.pos + 1, insert: this.checked ? ' ' : 'x' } });
    });
    return el;
  }
  ignoreEvent() { return false; }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function cursorOnLine(sel: EditorSelection, lineFrom: number, lineTo: number): boolean {
  return sel.ranges.some((r) => r.from <= lineTo && r.to >= lineFrom);
}

function cursorInSpan(sel: EditorSelection, from: number, to: number): boolean {
  return sel.ranges.some((r) => r.from < to && r.to > from);
}

// ── Build decorations ─────────────────────────────────────────────────────────

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const sel = view.state.selection;
  const doc = view.state.doc;

  type Entry = { from: number; to: number; deco: Decoration };
  const entries: Entry[] = [];

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = doc.lineAt(pos);
      const { text, from: lf, to: lt } = line;
      const onLine = cursorOnLine(sel, lf, lt);

      // ── Heading ──────────────────────────────────────────────────────────
      const hMatch = text.match(/^(#{1,6}) /);
      if (hMatch) {
        const level = hMatch[1].length;
        entries.push({ from: lf, to: lt, deco: Decoration.line({ class: `cm-md-h cm-md-h${level}` }) });
        if (!onLine) {
          entries.push({ from: lf, to: lf + level + 1, deco: Decoration.replace({}) });
        }
        pos = lt + 1;
        continue;
      }

      // ── Horizontal rule ───────────────────────────────────────────────────
      if (/^-{3,}$/.test(text.trim()) && !onLine) {
        entries.push({ from: lf, to: lt, deco: Decoration.replace({ widget: new HrWidget(), block: true }) });
        pos = lt + 1;
        continue;
      }

      // ── Blockquote ────────────────────────────────────────────────────────
      if (text.startsWith('>')) {
        entries.push({ from: lf, to: lt, deco: Decoration.line({ class: 'cm-md-blockquote' }) });
      }

      // ── Checkbox ─────────────────────────────────────────────────────────
      if (!onLine) {
        const cbMatch = text.match(/^(\s*[-*+] )(\[[ x]\])/i);
        if (cbMatch) {
          const checked = cbMatch[2][1].toLowerCase() === 'x';
          const cbFrom = lf + cbMatch[1].length;
          entries.push({ from: cbFrom, to: cbFrom + 3, deco: Decoration.replace({ widget: new CheckboxWidget(checked, cbFrom + 1) }) });
        }
      }

      // ── Inline marks (Decoration.mark only — no cursor impact) ───────────

      for (const m of text.matchAll(/\*\*(.+?)\*\*/g)) {
        const mf = lf + m.index!;
        const mt = mf + m[0].length;
        entries.push({ from: mf, to: mt, deco: Decoration.mark({ class: 'cm-md-bold' }) });
      }

      for (const m of text.matchAll(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g)) {
        const mf = lf + m.index!;
        const mt = mf + m[0].length;
        entries.push({ from: mf, to: mt, deco: Decoration.mark({ class: 'cm-md-italic' }) });
      }

      for (const m of text.matchAll(/~~(.+?)~~/g)) {
        const mf = lf + m.index!;
        const mt = mf + m[0].length;
        entries.push({ from: mf, to: mt, deco: Decoration.mark({ class: 'cm-md-strike' }) });
      }

      for (const m of text.matchAll(/`([^`]+)`/g)) {
        const mf = lf + m.index!;
        const mt = mf + m[0].length;
        entries.push({ from: mf, to: mt, deco: Decoration.mark({ class: 'cm-md-code' }) });
      }

      // ── Wikilinks (replace widget, only when cursor not inside) ───────────
      for (const m of text.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)) {
        const mf = lf + m.index!;
        const mt = mf + m[0].length;
        if (!cursorInSpan(sel, mf, mt)) {
          const label = (m[2] ?? m[1]).trim();
          entries.push({ from: mf, to: mt, deco: Decoration.replace({ widget: new WikilinkWidget(label) }) });
        }
      }

      pos = lt + 1;
    }
  }

  // Sort by from asc, to desc
  entries.sort((a, b) => a.from !== b.from ? a.from - b.from : b.to - a.to);

  // Drop overlapping replace decorations
  const safe: Entry[] = [];
  let lastReplaceEnd = -1;
  for (const e of entries) {
    const isReplace = (e.deco as { spec?: { widget?: unknown } }).spec?.widget !== undefined
      || e.deco.startSide === -1;
    if (isReplace) {
      if (e.from < lastReplaceEnd) continue;
      lastReplaceEnd = e.to;
    }
    safe.push(e);
  }

  for (const { from, to, deco } of safe) {
    builder.add(from, to, deco);
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
  '.cm-content': { maxWidth: '720px', margin: '0 auto', padding: '24px 0', fontFamily: "'Inter', system-ui, sans-serif" },
  '.cm-line': { lineHeight: '1.75', fontSize: '16px', padding: '0 32px' },

  '.cm-md-h':  { fontWeight: '700' },
  '.cm-md-h1': { fontSize: '2em',   lineHeight: '1.3' },
  '.cm-md-h2': { fontSize: '1.5em', lineHeight: '1.35' },
  '.cm-md-h3': { fontSize: '1.25em' },
  '.cm-md-h4': { fontSize: '1.1em' },
  '.cm-md-h5': { fontSize: '1em' },
  '.cm-md-h6': { fontSize: '0.9em', color: 'var(--color-text-muted)' },

  '.cm-md-blockquote': {
    borderLeft: '3px solid var(--color-accent)',
    paddingLeft: '1em',
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
    borderBottom: '1px solid color-mix(in srgb, var(--color-accent) 50%, transparent)',
  },

  '.cm-hr-line': {
    borderTop: '1px solid var(--color-border)',
    margin: '8px 32px',
    height: '1px',
    display: 'block',
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
