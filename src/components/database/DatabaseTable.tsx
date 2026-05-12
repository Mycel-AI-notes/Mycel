import { useRef, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import type { ColumnDef, Row, ViewDef } from '@/types/database';
import { PAGE_COL } from '@/types/database';
import { DatabaseCell } from './DatabaseCell';
import { DatabaseColumnMenu } from './DatabaseColumnMenu';

interface Props {
  dbPath: string;
  schema: Record<string, ColumnDef>;
  view: ViewDef;
  rows: Row[];
  onCellChange: (rowId: string, columnId: string, value: unknown) => void | Promise<void>;
  onAddOption: (columnId: string, opt: string) => void | Promise<void>;
  onDeleteRow: (rowId: string) => void | Promise<void>;
  onAddColumnClick: () => void;
  onRenameColumn: (columnId: string, label: string) => void | Promise<void>;
  onDeleteColumn: (columnId: string) => void | Promise<void>;
  onResizeColumn: (columnId: string, width: number) => void | Promise<void>;
  onSortColumn: (columnId: string, dir: 'asc' | 'desc' | null) => void;
  onRowReload: () => void;
}

interface EditingCell {
  rowId: string;
  columnId: string;
}

export function DatabaseTable({
  dbPath,
  schema,
  view,
  rows,
  onCellChange,
  onAddOption,
  onDeleteRow,
  onAddColumnClick,
  onRenameColumn,
  onDeleteColumn,
  onResizeColumn,
  onSortColumn,
  onRowReload,
}: Props) {
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  // Active column-header button so the popover knows where to anchor.
  const menuAnchorRef = useRef<HTMLButtonElement | null>(null);

  const visibleIds = view.visible_columns.filter(
    (c) => c === PAGE_COL || schema[c],
  );

  function startEdit(rowId: string, columnId: string) {
    if (columnId === PAGE_COL) return;
    const col = schema[columnId];
    if (!col) return;
    if (col.type === 'checkbox') return;
    setEditing({ rowId, columnId });
  }

  function commit() {
    setEditing(null);
  }

  function nextEditableColumn(currentId: string, dir: 1 | -1): string | null {
    const editable = visibleIds.filter(
      (c) => c !== PAGE_COL && schema[c]?.type !== 'checkbox',
    );
    const idx = editable.indexOf(currentId);
    if (idx === -1) return null;
    const next = idx + dir;
    if (next < 0 || next >= editable.length) return null;
    return editable[next];
  }

  function onCellKeyDown(e: React.KeyboardEvent, rowId: string, columnId: string) {
    if (!editing || editing.rowId !== rowId || editing.columnId !== columnId) return;
    if (e.key === 'Tab') {
      e.preventDefault();
      const dir = e.shiftKey ? -1 : 1;
      const nextCol = nextEditableColumn(columnId, dir);
      if (nextCol) {
        setEditing({ rowId, columnId: nextCol });
      } else {
        setEditing(null);
      }
    }
  }

  // Column resize. The CodeMirror widget that hosts this table calls
  // stopPropagation on mousedown/mouseup, which would prevent document-level
  // listeners from firing when the mouse is released inside the widget — the
  // resize would never end and the column would keep tracking the cursor.
  // Attach the move/up listeners in capture phase to run before that handler.
  function startResize(e: React.MouseEvent, columnId: string) {
    const target = e.currentTarget.parentElement as HTMLTableCellElement;
    const startX = e.clientX;
    const startW = target.offsetWidth;
    let lastWidth = startW;

    document.body.style.userSelect = 'none';
    document.body.style.cursor = 'col-resize';

    function onMove(ev: MouseEvent) {
      const dx = ev.clientX - startX;
      lastWidth = Math.max(60, startW + dx);
      document
        .querySelectorAll<HTMLTableCellElement>(`[data-db-col="${columnId}"]`)
        .forEach((th) => (th.style.width = `${lastWidth}px`));
    }
    function onUp() {
      document.removeEventListener('mousemove', onMove, true);
      document.removeEventListener('mouseup', onUp, true);
      document.body.style.userSelect = '';
      document.body.style.cursor = '';
      void onResizeColumn(columnId, lastWidth);
    }
    document.addEventListener('mousemove', onMove, true);
    document.addEventListener('mouseup', onUp, true);
    e.preventDefault();
  }

  return (
    <div className="db-table-wrap">
      <table className="db-table">
        <thead>
          <tr>
            {visibleIds.map((cid) => {
              const col = schema[cid];
              const isPage = cid === PAGE_COL;
              const label = isPage ? 'Page' : col?.label ?? cid;
              const width = isPage ? 160 : col?.width ?? 200;
              return (
                <th
                  key={cid}
                  data-db-col={cid}
                  style={{ width }}
                  className="db-th"
                >
                  <div className="db-th-inner">
                    {isPage ? (
                      <span>{label}</span>
                    ) : (
                      <button
                        ref={(el) => {
                          if (openMenuId === cid) menuAnchorRef.current = el;
                        }}
                        className="db-th-btn"
                        onClick={() => setOpenMenuId(openMenuId === cid ? null : cid)}
                      >
                        {label}
                      </button>
                    )}
                  </div>
                  {!isPage && col && openMenuId === cid && (
                    <DatabaseColumnMenu
                      key={cid}
                      anchorRef={menuAnchorRef}
                      columnId={cid}
                      column={col}
                      currentSort={view.sort ?? null}
                      onClose={() => setOpenMenuId(null)}
                      onRename={(lbl) => onRenameColumn(cid, lbl)}
                      onDelete={() => onDeleteColumn(cid)}
                      onSort={(dir) => onSortColumn(cid, dir)}
                    />
                  )}
                  {!isPage && (
                    <span
                      className="db-th-resizer"
                      onMouseDown={(e) => startResize(e, cid)}
                    />
                  )}
                </th>
              );
            })}
            <th className="db-th db-th-add">
              <button
                onClick={onAddColumnClick}
                className="db-th-add-btn"
                title="Add column"
              >
                <Plus size={12} />
              </button>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td className="db-empty" colSpan={visibleIds.length + 1}>
                No rows. Click "Add row" to start.
              </td>
            </tr>
          )}
          {rows.map((row) => (
            <tr key={row.id} className="db-tr">
              {visibleIds.map((cid) => {
                const col = schema[cid];
                const isEditing =
                  !!editing && editing.rowId === row.id && editing.columnId === cid;
                return (
                  <td
                    key={cid}
                    data-db-col={cid}
                    className="db-td"
                    style={{ width: cid === PAGE_COL ? 160 : col?.width ?? 200 }}
                    onClick={() => !isEditing && startEdit(row.id, cid)}
                    onKeyDown={(e) => onCellKeyDown(e, row.id, cid)}
                  >
                    <DatabaseCell
                      dbPath={dbPath}
                      row={row}
                      columnId={cid}
                      column={col}
                      editing={isEditing}
                      onCommit={commit}
                      onCellChange={onCellChange}
                      onAddOption={onAddOption}
                      onRowReload={onRowReload}
                    />
                  </td>
                );
              })}
              <td className="db-td db-td-actions">
                <button
                  onClick={() => onDeleteRow(row.id)}
                  className="db-icon-btn db-row-delete"
                  title="Delete row"
                >
                  <Trash2 size={12} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
