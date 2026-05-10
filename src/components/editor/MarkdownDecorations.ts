import {
  EditorView,
  Decoration,
  DecorationSet,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from '@codemirror/view';
import { RangeSetBuilder, EditorSelection } from '@codemirror/state';

// ── Widgets ──────────────────────────────────────────────────────────────────

class HrWidget extends WidgetType {
  toDOM() {
    const el = document.createElement('div');
    el.className = 'cm-hr-line';
    return el;
  }
  ignoreEvent() { return false; }
}

class CheckboxWidget extends WidgetType {
  constructor(private checked: boolean, private pos: number) { super(); }
  toDOM(view: EditorView) {
    const el = document.createElement('input');
    el.type = 'checkbox';
    el.checked = this.checked;
    el.className = 'cm-checkbox';
    el.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const newChar = this.checked ? ' ' : 'x';
      view.dispatch({
        changes: { from: this.pos, to: this.pos + 1, insert: newChar },
      });
    });
    return el;
  }
  ignoreEvent() { return false; }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function cursorInRange(sel: EditorSelection, from: number, to: number): boolean {
  return sel.ranges.some((r) => r.from <= to && r.to >= from);
}

function lineHasCursor(sel: EditorSelection, lineFrom: number, lineTo: number): boolean {
  return cursorInRange(sel, lineFrom, lineTo);
}

// ── Main plugin ───────────────────────────────────────────────────────────────

function buildDecorations(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const sel = view.state.selection;
  const doc = view.state.doc;

  // Collect all decorations with their positions, then sort before adding
  const decos: { from: number; to: number; deco: Decoration }[] = [];

  const add = (from: number, to: number, deco: Decoration) => {
    decos.push({ from, to, deco });
  };

  for (const { from, to } of view.visibleRanges) {
    let pos = from;
    while (pos <= to) {
      const line = doc.lineAt(pos);
      const text = line.text;
      const lineFrom = line.from;
      const lineTo = line.to;
      const hasCursor = lineHasCursor(sel, lineFrom, lineTo);

      // ── Headings ──────────────────────────────────────────────────────────
      const headingMatch = text.match(/^(#{1,6}) (.+)/);
      if (headingMatch && !hasCursor) {
        const level = headingMatch[1].length;
        const hashEnd = lineFrom + level + 1; // after "## "
        // Hide the "# " markers
        add(lineFrom, hashEnd, Decoration.replace({}));
        // Style the heading text
        add(
          lineFrom,
          lineTo,
          Decoration.line({ class: `cm-heading cm-heading-${level}` }),
        );
        pos = lineTo + 1;
        continue;
      }
      if (headingMatch && hasCursor) {
        const level = headingMatch[1].length;
        add(lineFrom, lineTo, Decoration.line({ class: `cm-heading cm-heading-${level}` }));
        pos = lineTo + 1;
        continue;
      }

      // ── Horizontal rule ───────────────────────────────────────────────────
      if (/^---+$/.test(text.trim()) && !hasCursor) {
        add(lineFrom, lineTo, Decoration.replace({ widget: new HrWidget() }));
        pos = lineTo + 1;
        continue;
      }

      // ── Blockquote ────────────────────────────────────────────────────────
      if (text.startsWith('>')) {
        add(lineFrom, lineTo, Decoration.line({ class: 'cm-blockquote' }));
        if (!hasCursor) {
          add(lineFrom, lineFrom + 1, Decoration.replace({}));
          if (text[1] === ' ') add(lineFrom + 1, lineFrom + 2, Decoration.replace({}));
        }
      }

      // ── Checkboxes ────────────────────────────────────────────────────────
      const cbMatch = text.match(/^(\s*[-*+] )(\[[ x]\])/i);
      if (cbMatch) {
        const checked = cbMatch[2][1].toLowerCase() === 'x';
        const cbFrom = lineFrom + cbMatch[1].length;
        const cbTo = cbFrom + 3;
        if (!hasCursor) {
          add(cbFrom, cbTo, Decoration.replace({ widget: new CheckboxWidget(checked, cbFrom + 1) }));
        }
      }

      // ── Inline spans (bold, italic, strikethrough, code, wikilinks) ───────
      if (!hasCursor) {
        // Bold **text** or __text__
        for (const m of text.matchAll(/(\*\*|__)(.+?)\1/g)) {
          const mFrom = lineFrom + m.index!;
          const mTo = mFrom + m[0].length;
          if (cursorInRange(sel, mFrom, mTo)) continue;
          add(mFrom, mFrom + m[1].length, Decoration.mark({ class: 'cm-hide' }));
          add(mFrom, mTo, Decoration.mark({ class: 'cm-bold' }));
          add(mTo - m[1].length, mTo, Decoration.mark({ class: 'cm-hide' }));
        }

        // Italic *text* or _text_ (not part of **)
        for (const m of text.matchAll(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)|(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/g)) {
          const mFrom = lineFrom + m.index!;
          const mTo = mFrom + m[0].length;
          if (cursorInRange(sel, mFrom, mTo)) continue;
          add(mFrom, mFrom + 1, Decoration.mark({ class: 'cm-hide' }));
          add(mFrom, mTo, Decoration.mark({ class: 'cm-italic' }));
          add(mTo - 1, mTo, Decoration.mark({ class: 'cm-hide' }));
        }

        // Strikethrough ~~text~~
        for (const m of text.matchAll(/~~(.+?)~~/g)) {
          const mFrom = lineFrom + m.index!;
          const mTo = mFrom + m[0].length;
          if (cursorInRange(sel, mFrom, mTo)) continue;
          add(mFrom, mFrom + 2, Decoration.mark({ class: 'cm-hide' }));
          add(mFrom, mTo, Decoration.mark({ class: 'cm-strikethrough' }));
          add(mTo - 2, mTo, Decoration.mark({ class: 'cm-hide' }));
        }

        // Inline code `code`
        for (const m of text.matchAll(/`([^`]+)`/g)) {
          const mFrom = lineFrom + m.index!;
          const mTo = mFrom + m[0].length;
          if (cursorInRange(sel, mFrom, mTo)) continue;
          add(mFrom, mFrom + 1, Decoration.mark({ class: 'cm-hide' }));
          add(mFrom + 1, mTo - 1, Decoration.mark({ class: 'cm-inline-code' }));
          add(mTo - 1, mTo, Decoration.mark({ class: 'cm-hide' }));
        }

        // Wikilinks [[target]] or [[target|alias]]
        for (const m of text.matchAll(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g)) {
          const mFrom = lineFrom + m.index!;
          const mTo = mFrom + m[0].length;
          if (cursorInRange(sel, mFrom, mTo)) continue;
          const display = m[2] ?? m[1];
          // Replace entire [[...]] with styled span showing display text
          add(
            mFrom,
            mTo,
            Decoration.replace({
              widget: new WikilinkWidget(display.trim()),
            }),
          );
        }
      }

      pos = lineTo + 1;
    }
  }

  // Sort by from position, then by to position descending (wider ranges first)
  decos.sort((a, b) => {
    if (a.from !== b.from) return a.from - b.from;
    return b.to - a.to;
  });

  for (const { from, to, deco } of decos) {
    builder.add(from, to, deco);
  }

  return builder.finish();
}

class WikilinkWidget extends WidgetType {
  constructor(private label: string) { super(); }
  toDOM() {
    const span = document.createElement('span');
    span.className = 'cm-wikilink';
    span.textContent = this.label;
    return span;
  }
  ignoreEvent() { return false; }
}

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

// ── Editor theme additions ────────────────────────────────────────────────────

export const markdownPreviewTheme = EditorView.baseTheme({
  // Typography
  '&': { fontFamily: "'Inter', system-ui, sans-serif" },
  '.cm-content': { maxWidth: '720px', margin: '0 auto', padding: '24px 0' },
  '.cm-line': { lineHeight: '1.75', fontSize: '16px', padding: '0 32px' },

  // Hide markers
  '.cm-hide': { display: 'none' },

  // Headings
  '.cm-heading-1': { fontSize: '2em', fontWeight: '700', marginTop: '0.5em' },
  '.cm-heading-2': { fontSize: '1.5em', fontWeight: '600' },
  '.cm-heading-3': { fontSize: '1.25em', fontWeight: '600' },
  '.cm-heading-4': { fontSize: '1.1em', fontWeight: '600' },
  '.cm-heading-5': { fontSize: '1em', fontWeight: '600' },
  '.cm-heading-6': { fontSize: '0.9em', fontWeight: '600', color: 'var(--color-text-muted)' },

  // Inline styles
  '.cm-bold': { fontWeight: '700' },
  '.cm-italic': { fontStyle: 'italic' },
  '.cm-strikethrough': { textDecoration: 'line-through', opacity: '0.6' },
  '.cm-inline-code': {
    fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
    fontSize: '0.875em',
    backgroundColor: 'var(--color-surface-2)',
    borderRadius: '3px',
    padding: '1px 4px',
  },

  // Wikilink
  '.cm-wikilink': {
    color: 'var(--color-accent)',
    cursor: 'pointer',
    borderBottom: '1px solid var(--color-accent)',
    textDecoration: 'none',
  },

  // Blockquote
  '.cm-blockquote': {
    borderLeft: '3px solid var(--color-accent)',
    paddingLeft: '1em',
    color: 'var(--color-text-muted)',
    fontStyle: 'italic',
  },

  // HR
  '.cm-hr-line': {
    borderTop: '1px solid var(--color-border)',
    margin: '1em 0',
    height: '1px',
  },

  // Checkbox
  '.cm-checkbox': {
    cursor: 'pointer',
    accentColor: 'var(--color-accent)',
    width: '14px',
    height: '14px',
    marginRight: '4px',
    verticalAlign: 'middle',
  },
});
