import { useState } from 'react';
import type { ColumnDef, ColumnType } from '@/types/database';

interface Props {
  onSubmit: (columnId: string, def: ColumnDef) => void;
  onCancel: () => void;
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

export function AddColumnModal({ onSubmit, onCancel }: Props) {
  const [label, setLabel] = useState('');
  const [type, setType] = useState<ColumnType>('text');
  const [optionsRaw, setOptionsRaw] = useState('');

  const needsOptions = type === 'select' || type === 'multi-select';

  function submit() {
    const trimmed = label.trim();
    if (!trimmed) return;
    const id = toId(trimmed) || `col_${Date.now()}`;
    const def: ColumnDef = {
      type,
      label: trimmed,
    };
    if (needsOptions) {
      const opts = optionsRaw
        .split(/[,\n]/)
        .map((s) => s.trim())
        .filter(Boolean);
      def.options = opts;
    }
    onSubmit(id, def);
  }

  return (
    <div className="db-modal-overlay" onMouseDown={onCancel}>
      <div className="db-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3 className="db-modal-title">Add column</h3>
        <label className="db-modal-field">
          <span>Name</span>
          <input
            autoFocus
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
              if (e.key === 'Escape') onCancel();
            }}
          />
        </label>
        <label className="db-modal-field">
          <span>Type</span>
          <select value={type} onChange={(e) => setType(e.target.value as ColumnType)}>
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        {needsOptions && (
          <label className="db-modal-field">
            <span>Options (comma-separated)</span>
            <input
              value={optionsRaw}
              onChange={(e) => setOptionsRaw(e.target.value)}
              placeholder="todo, doing, done"
            />
          </label>
        )}
        <div className="db-modal-actions">
          <button onClick={onCancel} className="db-btn">
            Cancel
          </button>
          <button onClick={submit} className="db-btn db-btn-primary">
            Add
          </button>
        </div>
      </div>
    </div>
  );
}
