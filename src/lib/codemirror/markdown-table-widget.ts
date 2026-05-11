import {
  Decoration,
  DecorationSet,
  EditorView,
  WidgetType,
} from '@codemirror/view';
import {
  EditorState,
  RangeSetBuilder,
  StateField,
} from '@codemirror/state';

type Align = 'left' | 'center' | 'right' | null;

interface TableBlock {
  from: number;
  to: number;
  startLine: number;
  endLine: number;
  headers: string[];
  aligns: Align[];
  rows: string[][];
}

const SEPARATOR_RE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;
const TABLE_LINE_RE = /\|/;

function splitRow(text: string): string[] {
  let s = text.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  const out: string[] = [];
  let buf = '';
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '\\' && s[i + 1] === '|') {
      buf += '|';
      i++;
      continue;
    }
    if (c === '|') {
      out.push(buf.trim());
      buf = '';
      continue;
    }
    buf += c;
  }
  out.push(buf.trim());
  return out;
}

function parseAlign(cell: string): Align {
  const t = cell.trim();
  const left = t.startsWith(':');
  const right = t.endsWith(':');
  if (left && right) return 'center';
  if (right) return 'right';
  if (left) return 'left';
  return null;
}

function findTableBlocks(state: EditorState): TableBlock[] {
  const doc = state.doc;
  const out: TableBlock[] = [];
  let n = 1;
  while (n <= doc.lines) {
    const header = doc.line(n);
    if (n + 1 > doc.lines || !TABLE_LINE_RE.test(header.text)) {
      n++;
      continue;
    }
    const sep = doc.line(n + 1);
    if (!SEPARATOR_RE.test(sep.text)) {
      n++;
      continue;
    }
    const headers = splitRow(header.text);
    const sepCells = splitRow(sep.text);
    if (sepCells.length !== headers.length) {
      n++;
      continue;
    }
    const aligns = sepCells.map(parseAlign);

    const rows: string[][] = [];
    let endLine = n + 1;
    let m = n + 2;
    while (m <= doc.lines) {
      const l = doc.line(m);
      if (!TABLE_LINE_RE.test(l.text) || l.text.trim() === '') break;
      const cells = splitRow(l.text);
      while (cells.length < headers.length) cells.push('');
      if (cells.length > headers.length) cells.length = headers.length;
      rows.push(cells);
      endLine = m;
      m++;
    }

    out.push({
      from: header.from,
      to: doc.line(endLine).to,
      startLine: n,
      endLine,
      headers,
      aligns,
      rows,
    });
    n = endLine + 1;
  }
  return out;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function renderNonCode(seg: string): string {
  let s = escapeHtml(seg);
  s = s.replace(/\[([^\]\n]+)\]\(([^)\s]+)\)/g, (_m, label: string, href: string) => {
    return '<a href="' + href + '" target="_blank" rel="noopener noreferrer">' + label + '</a>';
  });
  s = s.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/(?<![*\w])\*(?!\*)([^*\n]+?)\*(?![*\w])/g, '<em>$1</em>');
  s = s.replace(/~~([^\n]+?)~~/g, '<del>$1</del>');
  return s;
}

function renderInline(raw: string): string {
  let out = '';
  const re = /`([^`\n]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(raw)) !== null) {
    out += renderNonCode(raw.slice(last, m.index));
    out += '<code>' + escapeHtml(m[1]) + '</code>';
    last = m.index + m[0].length;
  }
  out += renderNonCode(raw.slice(last));
  return out;
}

class TableWidget extends WidgetType {
  constructor(private block: TableBlock) {
    super();
  }

  eq(other: TableWidget): boolean {
    const a = this.block;
    const b = other.block;
    if (a.headers.length !== b.headers.length) return false;
    if (a.rows.length !== b.rows.length) return false;
    for (let i = 0; i < a.headers.length; i++) {
      if (a.headers[i] !== b.headers[i]) return false;
      if (a.aligns[i] !== b.aligns[i]) return false;
    }
    for (let r = 0; r < a.rows.length; r++) {
      for (let c = 0; c < a.headers.length; c++) {
        if (a.rows[r][c] !== b.rows[r][c]) return false;
      }
    }
    return true;
  }

  get estimatedHeight() {
    return 40 + this.block.rows.length * 32;
  }

  toDOM(): HTMLElement {
    const wrap = document.createElement('div');
    wrap.className = 'cm-md-table-widget';
    wrap.contentEditable = 'false';

    const table = document.createElement('table');
    table.className = 'cm-md-table';

    const thead = document.createElement('thead');
    const trh = document.createElement('tr');
    for (let i = 0; i < this.block.headers.length; i++) {
      const th = document.createElement('th');
      const a = this.block.aligns[i];
      if (a) th.style.textAlign = a;
      th.innerHTML = renderInline(this.block.headers[i]);
      trh.appendChild(th);
    }
    thead.appendChild(trh);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    for (const row of this.block.rows) {
      const tr = document.createElement('tr');
      for (let i = 0; i < this.block.headers.length; i++) {
        const td = document.createElement('td');
        const a = this.block.aligns[i];
        if (a) td.style.textAlign = a;
        td.innerHTML = renderInline(row[i] ?? '');
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    table.appendChild(tbody);
    wrap.appendChild(table);
    return wrap;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

function buildDecorations(state: EditorState): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const blocks = findTableBlocks(state);
  const sel = state.selection;
  for (const b of blocks) {
    const cursorInside = sel.ranges.some(
      (r) => r.from <= b.to && r.to >= b.from,
    );
    if (cursorInside) continue;
    builder.add(
      b.from,
      b.to,
      Decoration.replace({
        widget: new TableWidget(b),
        block: true,
      }),
    );
  }
  return builder.finish();
}

export const markdownTableField = StateField.define<DecorationSet>({
  create: (state) => buildDecorations(state),
  update(deco, tr) {
    if (tr.docChanged || tr.selection) return buildDecorations(tr.state);
    return deco.map(tr.changes);
  },
  provide: (f) => EditorView.decorations.from(f),
});

export const markdownTableTheme = EditorView.baseTheme({
  '.cm-md-table-widget': {
    margin: '12px 24px',
    overflowX: 'auto',
  },
  '.cm-md-table': {
    borderCollapse: 'collapse',
    fontFamily: "'Inter', system-ui, sans-serif",
    fontSize: '0.95em',
    lineHeight: '1.5',
    width: 'auto',
    minWidth: '50%',
  },
  '.cm-md-table th, .cm-md-table td': {
    border: '1px solid var(--color-border)',
    padding: '6px 12px',
    textAlign: 'left',
    verticalAlign: 'top',
  },
  '.cm-md-table th': {
    backgroundColor: 'var(--color-surface-2)',
    fontWeight: '600',
    color: 'var(--color-text-primary)',
  },
  '.cm-md-table tbody tr:nth-child(even) td': {
    backgroundColor: 'color-mix(in srgb, var(--color-surface-2) 35%, transparent)',
  },
  '.cm-md-table code': {
    fontFamily: "'JetBrains Mono', monospace",
    fontSize: '0.875em',
    backgroundColor: 'var(--color-code-bg)',
    color: 'var(--color-inline-code)',
    borderRadius: '3px',
    padding: '1px 5px',
  },
  '.cm-md-table a': {
    color: 'var(--color-accent)',
    textDecoration: 'underline',
  },
});
