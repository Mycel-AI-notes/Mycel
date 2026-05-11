import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Plus, Trash2, AlignLeft, AlignCenter, AlignRight } from 'lucide-react';
import type { Align, TableData } from '@/lib/table/serialize';
import { renderInlineMarkdown } from '@/components/markdown/InlineMarkdown';

interface Props {
  data: TableData;
  onChange: (next: TableData) => void;
  onRemove: () => void;
}

const ALIGN_CYCLE: Align[] = [null, 'left', 'center', 'right'];

function nextAlign(a: Align): Align {
  const i = ALIGN_CYCLE.indexOf(a);
  return ALIGN_CYCLE[(i + 1) % ALIGN_CYCLE.length];
}

function alignIcon(a: Align) {
  if (a === 'center') return <AlignCenter size={11} />;
  if (a === 'right') return <AlignRight size={11} />;
  return <AlignLeft size={11} />;
}

export function EditableTable({ data, onChange, onRemove }: Props) {
  const [hoverRow, setHoverRow] = useState<number | null>(null);

  const setHeader = (i: number, value: string) => {
    const headers = data.headers.slice();
    headers[i] = value;
    onChange({ ...data, headers });
  };

  const setCell = (r: number, c: number, value: string) => {
    const rows = data.rows.map((row) => row.slice());
    rows[r][c] = value;
    onChange({ ...data, rows });
  };

  const addRow = (at?: number) => {
    const rows = data.rows.map((row) => row.slice());
    const blank = data.headers.map(() => '');
    const idx = at ?? rows.length;
    rows.splice(idx, 0, blank);
    onChange({ ...data, rows });
  };

  const removeRow = (idx: number) => {
    const rows = data.rows.filter((_, i) => i !== idx);
    onChange({ ...data, rows });
  };

  const addCol = (at?: number) => {
    const idx = at ?? data.headers.length;
    const headers = data.headers.slice();
    headers.splice(idx, 0, `Column ${data.headers.length + 1}`);
    const aligns = data.aligns.slice();
    aligns.splice(idx, 0, null);
    const rows = data.rows.map((row) => {
      const next = row.slice();
      next.splice(idx, 0, '');
      return next;
    });
    onChange({ headers, aligns, rows });
  };

  const removeCol = (idx: number) => {
    if (data.headers.length <= 1) return;
    const headers = data.headers.filter((_, i) => i !== idx);
    const aligns = data.aligns.filter((_, i) => i !== idx);
    const rows = data.rows.map((row) => row.filter((_, i) => i !== idx));
    onChange({ headers, aligns, rows });
  };

  const cycleAlign = (idx: number) => {
    const aligns = data.aligns.slice();
    aligns[idx] = nextAlign(aligns[idx] ?? null);
    onChange({ ...data, aligns });
  };

  return (
    <div className="md-table-root" onMouseLeave={() => setHoverRow(null)}>
      <div className="md-table-scroll">
        <table className="md-table">
          <thead>
            <tr>
              {data.headers.map((h, i) => (
                <th
                  key={i}
                  style={{ textAlign: data.aligns[i] ?? 'left' }}
                >
                  <div className="md-table-th">
                    <CellInput
                      value={h}
                      onChange={(v) => setHeader(i, v)}
                      placeholder={`Column ${i + 1}`}
                      align={data.aligns[i]}
                      bold
                    />
                    <div className="md-table-col-tools">
                      <button
                        className="md-table-icon-btn"
                        title="Cycle alignment"
                        onClick={() => cycleAlign(i)}
                      >
                        {alignIcon(data.aligns[i])}
                      </button>
                      <button
                        className="md-table-icon-btn md-table-icon-danger"
                        title="Delete column"
                        onClick={() => removeCol(i)}
                        disabled={data.headers.length <= 1}
                      >
                        <Trash2 size={11} />
                      </button>
                    </div>
                  </div>
                </th>
              ))}
              <th className="md-table-add-col-cell">
                <button
                  className="md-table-add-btn"
                  title="Add column"
                  onClick={() => addCol()}
                >
                  <Plus size={12} />
                </button>
              </th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((row, r) => (
              <tr
                key={r}
                onMouseEnter={() => setHoverRow(r)}
              >
                {row.map((cell, c) => (
                  <td
                    key={c}
                    style={{ textAlign: data.aligns[c] ?? 'left' }}
                  >
                    <CellInput
                      value={cell}
                      onChange={(v) => setCell(r, c, v)}
                      align={data.aligns[c]}
                    />
                  </td>
                ))}
                <td className="md-table-row-tools-cell">
                  {hoverRow === r && (
                    <button
                      className="md-table-icon-btn md-table-icon-danger"
                      title="Delete row"
                      onClick={() => removeRow(r)}
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </td>
              </tr>
            ))}
            <tr>
              <td colSpan={data.headers.length + 1} className="md-table-add-row-cell">
                <button
                  className="md-table-add-btn md-table-add-btn-wide"
                  title="Add row"
                  onClick={() => addRow()}
                >
                  <Plus size={12} /> <span>Add row</span>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <div className="md-table-footer">
        <button
          className="md-table-footer-btn"
          onClick={onRemove}
          title="Remove table from page"
        >
          <Trash2 size={11} /> Remove table
        </button>
      </div>
    </div>
  );
}

interface CellInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  align: Align;
  bold?: boolean;
}

function CellInput({ value, onChange, placeholder, align, bold }: CellInputProps) {
  const [local, setLocal] = useState(value);
  const [editing, setEditing] = useState(false);
  const ref = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setLocal(value);
  }, [value]);

  useLayoutEffect(() => {
    if (!editing) return;
    const el = ref.current;
    if (!el) return;
    el.style.height = '0px';
    el.style.height = `${el.scrollHeight}px`;
  }, [local, editing]);

  const cellStyle = {
    textAlign: align ?? 'left',
    fontWeight: bold ? 600 : 400,
  } as const;

  if (!editing) {
    const isEmpty = local.length === 0;
    return (
      <div
        className={`md-table-cell-preview${isEmpty ? ' md-table-cell-preview-empty' : ''}`}
        style={cellStyle}
        onMouseDown={(e) => {
          e.preventDefault();
          setEditing(true);
          requestAnimationFrame(() => {
            const el = ref.current;
            if (el) {
              el.focus();
              const len = el.value.length;
              el.setSelectionRange(len, len);
            }
          });
        }}
      >
        {isEmpty ? placeholder ?? '' : renderInlineMarkdown(local)}
      </div>
    );
  }

  return (
    <textarea
      ref={ref}
      className="md-table-cell-input"
      value={local}
      placeholder={placeholder}
      style={cellStyle}
      rows={1}
      autoFocus
      onChange={(e) => setLocal(e.target.value)}
      onBlur={() => {
        if (local !== value) onChange(local);
        setEditing(false);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          (e.target as HTMLTextAreaElement).blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          setLocal(value);
          setEditing(false);
        }
      }}
    />
  );
}
