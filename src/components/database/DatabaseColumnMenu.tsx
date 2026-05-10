import { useEffect, useRef, useState } from 'react';
import type { ColumnDef, SortDef } from '@/types/database';

interface Props {
  columnId: string;
  column: ColumnDef;
  currentSort?: SortDef | null;
  onClose: () => void;
  onRename: (label: string) => void;
  onDelete: () => void;
  onSort: (dir: 'asc' | 'desc' | null) => void;
}

export function DatabaseColumnMenu({
  columnId,
  column,
  currentSort,
  onClose,
  onRename,
  onDelete,
  onSort,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(column.label);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  const sortedAsc = currentSort?.field === columnId && currentSort.dir === 'asc';
  const sortedDesc = currentSort?.field === columnId && currentSort.dir === 'desc';

  return (
    <div ref={ref} className="db-popover db-column-menu">
      {renaming ? (
        <input
          autoFocus
          className="db-popover-input"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              onRename(draft.trim() || column.label);
              onClose();
            } else if (e.key === 'Escape') {
              onClose();
            }
          }}
          onBlur={() => onClose()}
        />
      ) : (
        <>
          <button className="db-popover-item" onClick={() => setRenaming(true)}>
            Rename
          </button>
          <button
            className={`db-popover-item ${sortedAsc ? 'is-active' : ''}`}
            onClick={() => {
              onSort(sortedAsc ? null : 'asc');
              onClose();
            }}
          >
            Sort ascending
          </button>
          <button
            className={`db-popover-item ${sortedDesc ? 'is-active' : ''}`}
            onClick={() => {
              onSort(sortedDesc ? null : 'desc');
              onClose();
            }}
          >
            Sort descending
          </button>
          <div className="db-popover-divider" />
          <button
            className="db-popover-item db-popover-danger"
            onClick={() => {
              onDelete();
              onClose();
            }}
          >
            Delete column
          </button>
        </>
      )}
    </div>
  );
}
