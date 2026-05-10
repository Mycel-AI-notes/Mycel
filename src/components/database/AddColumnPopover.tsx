import { useState } from 'react';
import { createPortal } from 'react-dom';
import type { ColumnDef, ColumnType } from '@/types/database';
import { Select } from './Select';

interface Props {
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

export function AddColumnPopover({ existingIds, onSubmit, onClose }: Props) {
  const [label, setLabel] = useState('');
  const [type, setType] = useState<ColumnType>('text');
  const [optionsRaw, setOptionsRaw] = useState('');

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

  return createPortal(
    <div className="db-modal-overlay" onMouseDown={onClose}>
      <div
        className="db-modal db-add-column-modal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 className="db-modal-title">New column</h3>
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
        <div className="db-modal-actions">
          <button className="db-btn" onClick={onClose}>
            Cancel
          </button>
          <button className="db-btn db-btn-primary" onClick={submit}>
            Add
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
