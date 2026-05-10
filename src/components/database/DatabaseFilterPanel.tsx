import type { ColumnDef, FilterDef, ViewDef } from '@/types/database';
import { operatorsFor } from '@/lib/database/filtering';
import { Plus, X } from 'lucide-react';

interface Props {
  schema: Record<string, ColumnDef>;
  view: ViewDef;
  onChange: (next: ViewDef) => void;
}

export function DatabaseFilterPanel({ schema, view, onChange }: Props) {
  const columnIds = Object.keys(schema);

  function update(idx: number, patch: Partial<FilterDef>) {
    const next = view.filters.map((f, i) => (i === idx ? { ...f, ...patch } : f));
    onChange({ ...view, filters: next });
  }

  function remove(idx: number) {
    onChange({ ...view, filters: view.filters.filter((_, i) => i !== idx) });
  }

  function add() {
    if (columnIds.length === 0) return;
    const first = columnIds[0];
    const ops = operatorsFor(schema[first].type);
    onChange({
      ...view,
      filters: [...view.filters, { field: first, op: ops[0].op, value: '' }],
    });
  }

  return (
    <div className="db-filter-panel">
      {view.filters.length === 0 && (
        <div className="db-filter-empty">No filters yet.</div>
      )}
      {view.filters.map((f, idx) => {
        const col = schema[f.field];
        const ops = col ? operatorsFor(col.type) : [];
        const opDef = ops.find((o) => o.op === f.op) ?? ops[0];
        return (
          <div key={idx} className="db-filter-row">
            <select
              value={f.field}
              onChange={(e) => {
                const newField = e.target.value;
                const newOps = operatorsFor(schema[newField].type);
                update(idx, { field: newField, op: newOps[0].op, value: '' });
              }}
            >
              {columnIds.map((cid) => (
                <option key={cid} value={cid}>
                  {schema[cid].label}
                </option>
              ))}
            </select>
            <select
              value={f.op}
              onChange={(e) => update(idx, { op: e.target.value as FilterDef['op'] })}
            >
              {ops.map((o) => (
                <option key={o.op} value={o.op}>
                  {o.label}
                </option>
              ))}
            </select>
            {opDef?.needsValue && col?.type === 'select' && (
              <select
                value={String(f.value ?? '')}
                onChange={(e) => update(idx, { value: e.target.value })}
              >
                <option value="">—</option>
                {(col.options ?? []).map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            )}
            {opDef?.needsValue && col?.type !== 'select' && (
              <input
                type={col?.type === 'number' ? 'number' : col?.type === 'date' ? 'date' : 'text'}
                value={String(f.value ?? '')}
                onChange={(e) => update(idx, { value: e.target.value })}
              />
            )}
            <button className="db-icon-btn" onClick={() => remove(idx)} title="Remove">
              <X size={12} />
            </button>
          </div>
        );
      })}
      <button className="db-btn db-btn-ghost" onClick={add}>
        <Plus size={12} /> Add filter
      </button>
    </div>
  );
}
