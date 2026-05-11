export type Align = 'left' | 'center' | 'right' | null;

export interface TableData {
  headers: string[];
  aligns: Align[];
  rows: string[][];
}

const SEP_RE = /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)+\|?\s*$/;

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

export function parseTable(text: string): TableData {
  const lines = text.split('\n').filter((l) => l.trim() !== '');
  if (lines.length === 0) {
    return { headers: ['Column 1', 'Column 2'], aligns: [null, null], rows: [['', '']] };
  }
  const headers = splitRow(lines[0]);
  let aligns: Align[];
  let bodyStart: number;
  if (lines.length >= 2 && SEP_RE.test(lines[1])) {
    const sepCells = splitRow(lines[1]);
    aligns = sepCells.map(parseAlign);
    while (aligns.length < headers.length) aligns.push(null);
    bodyStart = 2;
  } else {
    aligns = headers.map(() => null);
    bodyStart = 1;
  }
  const rows: string[][] = [];
  for (let i = bodyStart; i < lines.length; i++) {
    const cells = splitRow(lines[i]);
    while (cells.length < headers.length) cells.push('');
    if (cells.length > headers.length) cells.length = headers.length;
    rows.push(cells);
  }
  return { headers, aligns, rows };
}

function escapeCell(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function alignMarker(a: Align): string {
  switch (a) {
    case 'left':
      return ':---';
    case 'right':
      return '---:';
    case 'center':
      return ':---:';
    default:
      return '---';
  }
}

export function serializeTable(data: TableData): string {
  const { headers, aligns, rows } = data;
  const cols = headers.length;
  const widths = headers.map((h) => Math.max(3, escapeCell(h).length));
  for (const r of rows) {
    for (let i = 0; i < cols; i++) {
      const c = escapeCell(r[i] ?? '');
      if (c.length > widths[i]) widths[i] = c.length;
    }
  }
  const padCell = (s: string, i: number, a: Align) => {
    const v = escapeCell(s);
    const pad = widths[i] - v.length;
    if (a === 'right') return ' '.repeat(pad) + v;
    if (a === 'center') {
      const left = Math.floor(pad / 2);
      return ' '.repeat(left) + v + ' '.repeat(pad - left);
    }
    return v + ' '.repeat(pad);
  };
  const headerLine =
    '| ' + headers.map((h, i) => padCell(h, i, null)).join(' | ') + ' |';
  const sepLine =
    '| ' +
    aligns
      .map((a, i) => {
        const marker = alignMarker(a);
        const pad = widths[i] - (marker.length - 3 < 0 ? 3 : marker.length);
        const fill = '-'.repeat(Math.max(0, pad));
        if (a === 'left') return ':---' + fill;
        if (a === 'right') return fill + '---:';
        if (a === 'center') return ':---' + fill + ':';
        return '---' + fill;
      })
      .join(' | ') +
    ' |';
  const bodyLines = rows.map(
    (r) =>
      '| ' +
      headers.map((_, i) => padCell(r[i] ?? '', i, aligns[i])).join(' | ') +
      ' |',
  );
  return [headerLine, sepLine, ...bodyLines].join('\n');
}

export function emptyTable(cols = 2, rows = 2): TableData {
  const headers = Array.from({ length: cols }, (_, i) => `Column ${i + 1}`);
  const aligns: Align[] = headers.map(() => null);
  const body = Array.from({ length: rows }, () =>
    Array.from({ length: cols }, () => ''),
  );
  return { headers, aligns, rows: body };
}
