import { RefObject, useEffect, useRef, useState } from 'react';
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
  addColumnButtonRef?: RefObject<HTMLButtonElement | null>;
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
  addColumnButtonRef,
}: Props) {
  const [editing, setEditing] = useState<EditingCell | null>(null);
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const resizingRef = useRef<{ id: string; startX: number; startW: number } | null>(null);

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

  // Column resize handlers
  useEffect(() => {
    function onMove(e: MouseEvent) {
      const ctx = resizingRef.current;
      if (!ctx) return;
      const dx = e.clientX - ctx.startX;
      const next = Math.max(60, ctx.startW + dx);
      const headers = document.querySelectorAll<HTMLTableCellElement>(
        `[data-db-col="${ctx.id}"]`,
      );
      headers.forEach((th) => (th.style.width = `${next}px`));
    }
    function onUp() {
      const ctx = resizingRef.current;
      if (!ctx) return;
      const headers = document.querySelectorAll<HTMLTableCellElement>(
        `[data-db-col="${ctx.id}"]`,
      );
      const w = headers[0]?.offsetWidth ?? ctx.startW;
      resizingRef.current = null;
      document.body.style.userSelect = '';
      void onResizeColumn(ctx.id, w);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    return () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
  }, [onResizeColumn]);

  function startResize(e: React.MouseEvent, columnId: string) {
    const target = e.currentTarget.parentElement as HTMLTableCellElement;
    resizingRef.current = {
      id: columnId,
      startX: e.clientX,
      startW: target.offsetWidth,
    };
    document.body.style.userSelect = 'none';
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
                        className="db-th-btn"
                        onClick={() => setOpenMenuId(openMenuId === cid ? null : cid)}
                      >
                        {label}
                      </button>
                    )}
                  </div>
                  {!isPage && col && openMenuId === cid && (
                    <DatabaseColumnMenu
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
                ref={addColumnButtonRef}
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
