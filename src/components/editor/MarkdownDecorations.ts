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

class LinkWidget extends WidgetType {
  constructor(private label: string, private href: string) { super(); }
  eq(other: LinkWidget) { return this.label === other.label && this.href === other.href; }
  toDOM() {
    const a = document.createElement('a');
    a.className = 'cm-md-link';
    a.textContent = this.label;
    a.href = this.href;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    return a;
  }
  ignoreEvent() { return false; }
}

class HRWidget extends WidgetType {
  eq() { return true; }
  toDOM() {
    const div = document.createElement('div');
    div.className = 'cm-md-hr-widget';
    return div;
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
  return sel.ranges.some((r) => r.from <= to && r.to >= from);
}

const HIDE = Decoration.replace({});

// ── Build ─────────────────────────────────────────────────────────────────────

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { selection: sel, doc } = view.state;

  type LineDeco = { pos: number; deco: Decoration };
  type SpanDeco = { from: number; to: number; deco: Decoration };

  const lineDecos: LineDeco[] = [];
  const spanDecos: SpanDeco[] = [];

  const hide = (from: number, to: number) => {
    if (to > from) spanDecos.push({ from, to, deco: HIDE });
  };
  const mark = (from: number, to: number, cls: string) => {
    if (to > from) spanDecos.push({ from, to, deco: Decoration.mark({ class: cls }) });
  };

  const wrapInline = (mf: number, mt: number, n: number, cls: string) => {
    if (cursorInSpan(sel, mf, mt)) {
      mark(mf, mt, cls);
    } else {
      hide(mf, mf + n);
      mark(mf + n, mt - n, cls);
      hide(mt - n, mt);
    }
  };

  // Pre-scan from doc start up to the first visible position so we know
  // whether we're already inside a fenced code block when rendering starts.
  let inCodeBlock = false;
  const fenceRe = /^```/;
  const visStart = view.visibleRanges[0]?.from ?? 0;
  for (let p = 1; p < visStart; ) {
    const l = doc.lineAt(p);
    if (fenceRe.test(l.text)) inCodeBlock = !inCodeBlock;
    p = l.to + 1;
  }

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = doc.lineAt(pos);
      const { text, from: lf, to: lt } = line;
      const onLine = cursorOnLine(sel, lf, lt);

      // ── Fenced code block ──────────────────────────────────────────────────
      if (fenceRe.test(text)) {
        inCodeBlock = !inCodeBlock;
        lineDecos.push({ pos: lf, deco: Decoration.line({ class: 'cm-md-codeblock-line' }) });
        // Hide the ``` fence markers when cursor is not on this line
        if (!onLine && lt > lf) hide(lf, lt);
        pos = lt + 1;
        continue;
      }

      if (inCodeBlock) {
        lineDecos.push({ pos: lf, deco: Decoration.line({ class: 'cm-md-codeblock-line' }) });
        pos = lt + 1;
        continue;
      }

      // ── Normal markdown ────────────────────────────────────────────────────

      const hm = text.match(/^(#{1,6}) /);
      if (hm) {
        const level = hm[1].length;
        lineDecos.push({ pos: lf, deco: Decoration.line({ class: `cm-md-h cm-md-h${level}` }) });
        if (!onLine) hide(lf, lf + level + 1);
        pos = lt + 1;
        continue;
      }

      if (/^\s*-{3,}\s*$/.test(text) && text.trim().length >= 3) {
        if (!onLine && lt > lf) {
          spanDecos.push({
            from: lf,
            to: lt,
            deco: Decoration.replace({ widget: new HRWidget() }),
          });
        }
        pos = lt + 1;
        continue;
      }

      if (text.startsWith('> ')) {
        lineDecos.push({ pos: lf, deco: Decoration.line({ class: 'cm-md-blockquote' }) });
        if (!onLine) hide(lf, lf + 2);
      }

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

      // Collect inline code spans first so their content is protected from
      // bold/italic/etc. parsing below.
      const codeSpans: [number, number][] = [];
      for (const m of text.matchAll(/`([^`\n]+)`/g)) {
        const mf = lf + m.index!;
        const mt = mf + m[0].length;
        codeSpans.push([mf, mt]);
        wrapInline(mf, mt, 1, 'cm-md-code');
      }

      const inCode = (mf: number, mt: number) =>
        codeSpans.some(([cf, ct]) => mf < ct && mt > cf);

      for (const m of text.matchAll(/\*\*([^\n*][^\n]*?)\*\*/g)) {
        const mf = lf + m.index!;
        const mt = mf + m[0].length;
        if (!inCode(mf, mt)) wrapInline(mf, mt, 2, 'cm-md-bold');
      }

      for (const m of text.matchAll(/(?<![*\w])\*(?!\*)([^\n*]+?)\*(?![*\w])/g)) {
        const mf = lf + m.index!;
        const mt = mf + m[0].length;
        if (!inCode(mf, mt)) wrapInline(mf, mt, 1, 'cm-md-italic');
      }

      for (const m of text.matchAll(/~~([^\n]+?)~~/g)) {
        const mf = lf + m.index!;
        const mt = mf + m[0].length;
        if (!inCode(mf, mt)) wrapInline(mf, mt, 2, 'cm-md-strike');
      }

      for (const m of text.matchAll(/\[([^\]\n]+)\]\(([^)\s]+)\)/g)) {
        const mf = lf + m.index!;
        const mt = mf + m[0].length;
        if (inCode(mf, mt)) continue;
        if (cursorInSpan(sel, mf, mt)) {
          mark(mf, mt, 'cm-md-link-mark');
        } else {
          spanDecos.push({
            from: mf,
            to: mt,
            deco: Decoration.replace({ widget: new LinkWidget(m[1], m[2]) }),
          });
        }
      }

      for (const m of text.matchAll(/\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g)) {
        const mf = lf + m.index!;
        const mt = mf + m[0].length;
        if (inCode(mf, mt)) continue;
        if (!cursorInSpan(sel, mf, mt)) {
          const label = (m[2] ?? m[1]).trim();
          spanDecos.push({ from: mf, to: mt, deco: Decoration.replace({ widget: new WikilinkWidget(label) }) });
        }
      }

      pos = lt + 1;
    }
  }

  spanDecos.sort((a, b) => {
    if (a.from !== b.from) return a.from - b.from;
    const ar = a.deco.startSide < 0 ? 0 : 1;
    const br = b.deco.startSide < 0 ? 0 : 1;
    if (ar !== br) return ar - br;
    return b.to - a.to;
  });

  const safeSpans: SpanDeco[] = [];
  let replaceEnd = -1;
  for (const s of spanDecos) {
    const isReplace = s.deco.startSide < 0;
    if (isReplace) {
      if (s.from < replaceEnd) continue;
      replaceEnd = s.to;
    } else {
      if (s.from < replaceEnd && s.to <= replaceEnd) continue;
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
  '.cm-content': {
    width: '100%',
    maxWidth: '1024px',
    margin: '0 auto',
    padding: '24px 0',
    fontFamily: "'Inter', system-ui, sans-serif",
    boxSizing: 'border-box',
  },
  '.cm-line': { lineHeight: '1.75', fontSize: '16px', padding: '0 24px' },

  '.cm-md-h':  { fontWeight: '700', color: 'var(--color-text-primary)' },
  '.cm-md-h1': { fontSize: '2em',    lineHeight: '1.25' },
  '.cm-md-h2': { fontSize: '1.6em',  lineHeight: '1.3' },
  '.cm-md-h3': { fontSize: '1.3em',  lineHeight: '1.35' },
  '.cm-md-h4': { fontSize: '1.15em' },
  '.cm-md-h5': { fontSize: '1em' },
  '.cm-md-h6': { fontSize: '0.9em', color: 'var(--color-text-muted)' },

  '.cm-md-hr-widget': {
    display: 'inline-block',
    width: '100%',
    height: '1px',
    backgroundColor: 'var(--color-border)',
    verticalAlign: 'middle',
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
    color: 'var(--color-text-primary)',
    borderRadius: '3px',
    padding: '1px 5px',
  },

  '.cm-md-link': {
    color: 'var(--color-accent)',
    textDecoration: 'underline',
    cursor: 'pointer',
  },
  '.cm-md-link-mark': { color: 'var(--color-accent)' },

  '.cm-wikilink': {
    color: 'var(--color-accent)',
    cursor: 'pointer',
    borderBottom: '1px solid color-mix(in srgb, var(--color-accent) 40%, transparent)',
  },

  '.cm-md-codeblock-line': {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '0.875em',
    backgroundColor: 'var(--color-surface-2)',
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
