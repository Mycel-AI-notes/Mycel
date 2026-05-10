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

const HIDE = Decoration.replace({});

// ── Build ─────────────────────────────────────────────────────────────────────

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const { selection: sel, doc } = view.state;

  type LineDeco = { pos: number; deco: Decoration };
  type SpanDeco = { from: number; to: number; deco: Decoration };

  const lineDecos: LineDeco[] = [];
  const spanDecos: SpanDeco[] = [];

  const hide = (from: number, to: number) => spanDecos.push({ from, to, deco: HIDE });
  const mark = (from: number, to: number, cls: string) =>
    spanDecos.push({ from, to, deco: Decoration.mark({ class: cls }) });

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = doc.lineAt(pos);
      const { text, from: lf, to: lt } = line;
      const onLine = cursorOnLine(sel, lf, lt);

      // ── Headings ──────────────────────────────────────────────────────────
      const hm = text.match(/^(#{1,6}) /);
      if (hm) {
        const level = hm[1].length;
        lineDecos.push({ pos: lf, deco: Decoration.line({ class: `cm-md-h cm-md-h${level}` }) });
        if (!onLine) {
          // hide "## " prefix (level chars + 1 space)
          hide(lf, lf + level + 1);
        }
        pos = lt + 1;
        continue;
      }

      // ── HR ────────────────────────────────────────────────────────────────
      if (/^-{3,}\s*$/.test(text)) {
        // Only style as HR when cursor is off-line; otherwise show plain dashes
        // so they're editable.
        if (!onLine) {
          lineDecos.push({ pos: lf, deco: Decoration.line({ class: 'cm-md-hr' }) });
        }
        pos = lt + 1;
        continue;
      }

      // ── Blockquote ────────────────────────────────────────────────────────
      if (text.startsWith('> ')) {
        lineDecos.push({ pos: lf, deco: Decoration.line({ class: 'cm-md-blockquote' }) });
        if (!onLine) hide(lf, lf + 2);
      }

      // ── Checkbox ──────────────────────────────────────────────────────────
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

      // ── Bold **text** ─────────────────────────────────────────────────────
      for (const m of text.matchAll(/\*\*(.+?)\*\*/g)) {
        const mf = lf + m.index!;
        const mt = mf + m[0].length;
        if (cursorInSpan(sel, mf, mt)) {
          mark(mf, mt, 'cm-md-bold');
        } else {
          hide(mf, mf + 2);
          mark(mf + 2, mt - 2, 'cm-md-bold');
          hide(mt - 2, mt);
        }
      }

      // ── Italic *text* ─────────────────────────────────────────────────────
      for (const m of text.matchAll(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g)) {
        const mf = lf + m.index!;
        const mt = mf + m[0].length;
        if (cursorInSpan(sel, mf, mt)) {
          mark(mf, mt, 'cm-md-italic');
        } else {
          hide(mf, mf + 1);
          mark(mf + 1, mt - 1, 'cm-md-italic');
          hide(mt - 1, mt);
        }
      }

      // ── Strikethrough ~~text~~ ────────────────────────────────────────────
      for (const m of text.matchAll(/~~(.+?)~~/g)) {
        const mf = lf + m.index!;
        const mt = mf + m[0].length;
        if (cursorInSpan(sel, mf, mt)) {
          mark(mf, mt, 'cm-md-strike');
        } else {
          hide(mf, mf + 2);
          mark(mf + 2, mt - 2, 'cm-md-strike');
          hide(mt - 2, mt);
        }
      }

      // ── Inline code `text` ────────────────────────────────────────────────
      for (const m of text.matchAll(/`([^`]+)`/g)) {
        const mf = lf + m.index!;
        const mt = mf + m[0].length;
        if (cursorInSpan(sel, mf, mt)) {
          mark(mf, mt, 'cm-md-code');
        } else {
          hide(mf, mf + 1);
          mark(mf + 1, mt - 1, 'cm-md-code');
          hide(mt - 1, mt);
        }
      }

      // ── Wikilinks [[label]] ──────────────────────────────────────────────
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

  // Drop overlapping replace decorations (marks always pass through)
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

  // Merge line decos and span decos in position order
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
    maxWidth: '760px',
    margin: '0 auto',
    padding: '24px 0',
    fontFamily: "'Inter', system-ui, sans-serif",
  },
  '.cm-line': { lineHeight: '1.75', fontSize: '16px', padding: '0 32px' },

  // Headings — Obsidian-like: bigger + bolder
  '.cm-md-h':  { fontWeight: '700', color: 'var(--color-text-primary)' },
  '.cm-md-h1': { fontSize: '2em',    lineHeight: '1.25' },
  '.cm-md-h2': { fontSize: '1.6em',  lineHeight: '1.3' },
  '.cm-md-h3': { fontSize: '1.3em',  lineHeight: '1.35' },
  '.cm-md-h4': { fontSize: '1.15em' },
  '.cm-md-h5': { fontSize: '1em' },
  '.cm-md-h6': { fontSize: '0.9em', color: 'var(--color-text-muted)' },

  '.cm-md-hr': {
    position: 'relative',
    color: 'transparent',
    '&::before': {
      content: '""',
      position: 'absolute',
      left: '32px',
      right: '32px',
      top: '50%',
      borderTop: '1px solid var(--color-border)',
    },
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
