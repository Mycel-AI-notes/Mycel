import { RefObject, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { ColumnDef, SortDef } from '@/types/database';
import { useAnchorPos, useClickOutside } from './floating';

interface Props {
  anchorRef: RefObject<HTMLElement | null>;
  columnId: string;
  column: ColumnDef;
  currentSort?: SortDef | null;
  onClose: () => void;
  onRename: (label: string) => void;
  onDelete: () => void;
  onSort: (dir: 'asc' | 'desc' | null) => void;
}

export function DatabaseColumnMenu({
  anchorRef,
  columnId,
  column,
  currentSort,
  onClose,
  onRename,
  onDelete,
  onSort,
}: Props) {
  const popRef = useRef<HTMLDivElement>(null);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(column.label);
  const pos = useAnchorPos(anchorRef, true);
  useClickOutside([anchorRef, popRef], true, onClose);

  if (!pos) return null;

  const sortedAsc = currentSort?.field === columnId && currentSort.dir === 'asc';
  const sortedDesc =
    currentSort?.field === columnId && currentSort.dir === 'desc';

  return createPortal(
    <div
      ref={popRef}
      className="db-popover db-column-menu"
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        minWidth: Math.max(160, pos.minWidth),
        zIndex: 60,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
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
    </div>,
    document.body,
  );
}
