import {
  RefObject,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import type { ColumnDef, ColumnType } from '@/types/database';
import { Select } from './Select';

interface Props {
  anchorRef: RefObject<HTMLElement | null>;
  existingIds: Set<string>;
  onSubmit: (columnId: string, def: ColumnDef) => void;
  onClose: () => void;
}

const TYPES: { value: ColumnType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'number', label: 'Number' },
  { value: 'select', label: 'Select' },
  { value: 'multi-select', label: 'Multi-select' },
  { value: 'checkbox', label: 'Checkbox' },
  { value: 'date', label: 'Date' },
  { value: 'rich-text', label: 'Rich text' },
];

function toId(label: string) {
  return label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function uniqueId(base: string, taken: Set<string>): string {
  if (!taken.has(base)) return base;
  let i = 2;
  while (taken.has(`${base}_${i}`)) i += 1;
  return `${base}_${i}`;
}

interface AnchorPos {
  top: number;
  left: number;
}

export function AddColumnPopover({
  anchorRef,
  existingIds,
  onSubmit,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [label, setLabel] = useState('');
  const [type, setType] = useState<ColumnType>('text');
  const [optionsRaw, setOptionsRaw] = useState('');
  const [pos, setPos] = useState<AnchorPos | null>(null);

  // Position relative to the + button via portal so the popover is never
  // clipped by .db-table-wrap's overflow.
  useLayoutEffect(() => {
    function update() {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const popoverWidth = 260;
      // Anchor at the right edge of the + button, opening to the LEFT so the
      // popover doesn't fall off the right side of the screen.
      const left = Math.max(8, r.right - popoverWidth);
      setPos({ top: r.bottom + 4, left });
    }
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [anchorRef]);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        // Don't close when the click was on the trigger that opened us — the
        // trigger's click handler will already toggle us shut.
        const anchor = anchorRef.current;
        if (anchor && anchor.contains(e.target as Node)) return;
        onClose();
      }
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [anchorRef, onClose]);

  const needsOptions = type === 'select' || type === 'multi-select';

  function submit() {
    const trimmed = label.trim();
    if (!trimmed) return;
    const baseId = toId(trimmed) || `col_${Date.now()}`;
    const id = uniqueId(baseId, existingIds);
    const def: ColumnDef = { type, label: trimmed };
    if (needsOptions) {
      def.options = optionsRaw
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
    }
    onSubmit(id, def);
  }

  if (!pos) return null;

  return createPortal(
    <div
      ref={ref}
      className="db-popover db-add-column-popover"
      style={{
        position: 'fixed',
        top: pos.top,
        left: pos.left,
        zIndex: 60,
      }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="db-add-column-fields">
        <label className="db-settings-label">Name</label>
        <input
          autoFocus
          className="db-settings-input"
          value={label}
          placeholder="e.g. Status"
          onChange={(e) => setLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit();
            if (e.key === 'Escape') onClose();
          }}
        />
        <label className="db-settings-label">Type</label>
        <Select<ColumnType>
          value={type}
          options={TYPES.map((t) => ({ value: t.value, label: t.label }))}
          onChange={(v) => setType(v)}
        />
        {needsOptions && (
          <>
            <label className="db-settings-label">Options</label>
            <input
              className="db-settings-input"
              value={optionsRaw}
              placeholder="todo, doing, done"
              onChange={(e) => setOptionsRaw(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submit();
              }}
            />
          </>
        )}
      </div>
      <div className="db-add-column-actions">
        <button className="db-btn" onClick={onClose}>
          Cancel
        </button>
        <button className="db-btn db-btn-primary" onClick={submit}>
          Add
        </button>
      </div>
    </div>,
    document.body,
  );
}
