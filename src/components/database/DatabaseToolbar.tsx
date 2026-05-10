import { useEffect, useRef, useState } from 'react';
import {
  Plus,
  Filter,
  ArrowUpDown,
  Columns,
  Settings,
  Trash2,
} from 'lucide-react';
import type { ColumnDef, FilterDef, SortDef, ViewDef } from '@/types/database';
import { PAGE_COL } from '@/types/database';
import { operatorsFor } from '@/lib/database/filtering';

interface Props {
  schema: Record<string, ColumnDef>;
  view: ViewDef;
  rowLimit: number | null;
  onAddRow: () => void;
  onSortChange: (sort: SortDef | null) => void;
  onColumnsChange: (visibleColumns: string[]) => void;
  onFiltersChange: (filters: FilterDef[]) => void;
  onRowLimitChange: (limit: number | null) => void;
  onRemoveFromDoc?: () => void;
}

function usePopoverClose(
  ref: React.RefObject<HTMLElement | null>,
  onClose: () => void,
) {
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [ref, onClose]);
}

function ColumnsPopover({
  schema,
  visible,
  onChange,
  onClose,
}: {
  schema: Record<string, ColumnDef>;
  visible: string[];
  onChange: (next: string[]) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  usePopoverClose(ref, onClose);

  function toggle(id: string) {
    if (visible.includes(id)) onChange(visible.filter((c) => c !== id));
    else onChange([...visible, id]);
  }

  const items: { id: string; label: string }[] = [
    ...Object.entries(schema).map(([id, def]) => ({ id, label: def.label })),
    { id: PAGE_COL, label: 'Page' },
  ];

  return (
    <div ref={ref} className="db-popover db-columns-popover">
      {items.map((it) => (
        <label key={it.id} className="db-popover-item">
          <input
            type="checkbox"
            checked={visible.includes(it.id)}
            onChange={() => toggle(it.id)}
          />
          <span>{it.label}</span>
        </label>
      ))}
    </div>
  );
}

function SortPopover({
  schema,
  sort,
  onChange,
  onClose,
}: {
  schema: Record<string, ColumnDef>;
  sort: SortDef | null | undefined;
  onChange: (s: SortDef | null) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  usePopoverClose(ref, onClose);

  return (
    <div ref={ref} className="db-popover db-sort-popover">
      <div className="db-popover-row">
        <select
          value={sort?.field ?? ''}
          onChange={(e) => {
            const v = e.target.value;
            if (!v) onChange(null);
            else onChange({ field: v, dir: sort?.dir ?? 'asc' });
          }}
        >
          <option value="">—</option>
          {Object.entries(schema).map(([id, def]) => (
            <option key={id} value={id}>
              {def.label}
            </option>
          ))}
        </select>
        <select
          value={sort?.dir ?? 'asc'}
          disabled={!sort}
          onChange={(e) =>
            sort && onChange({ ...sort, dir: e.target.value as 'asc' | 'desc' })
          }
        >
          <option value="asc">Asc</option>
          <option value="desc">Desc</option>
        </select>
      </div>
      {sort && (
        <button
          className="db-popover-item db-popover-danger"
          onClick={() => {
            onChange(null);
            onClose();
          }}
        >
          Clear sort
        </button>
      )}
    </div>
  );
}

function FiltersModal({
  schema,
  filters,
  onChange,
  onClose,
}: {
  schema: Record<string, ColumnDef>;
  filters: FilterDef[];
  onChange: (next: FilterDef[]) => void;
  onClose: () => void;
}) {
  const columnIds = Object.keys(schema);

  function update(idx: number, patch: Partial<FilterDef>) {
    onChange(filters.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  }
  function remove(idx: number) {
    onChange(filters.filter((_, i) => i !== idx));
  }
  function add() {
    if (columnIds.length === 0) return;
    const first = columnIds[0];
    const ops = operatorsFor(schema[first].type);
    onChange([...filters, { field: first, op: ops[0].op, value: '' }]);
  }

  return (
    <div className="db-modal-overlay" onMouseDown={onClose}>
      <div
        className="db-modal db-filters-modal"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h3 className="db-modal-title">Filters</h3>
        <div className="db-filters-list">
          {filters.length === 0 && (
            <div className="db-filter-empty">No filters yet.</div>
          )}
          {filters.map((f, idx) => {
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
                    update(idx, {
                      field: newField,
                      op: newOps[0].op,
                      value: '',
                    });
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
                  onChange={(e) =>
                    update(idx, { op: e.target.value as FilterDef['op'] })
                  }
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
                    type={
                      col?.type === 'number'
                        ? 'number'
                        : col?.type === 'date'
                          ? 'date'
                          : 'text'
                    }
                    value={String(f.value ?? '')}
                    onChange={(e) => update(idx, { value: e.target.value })}
                  />
                )}
                <button
                  className="db-icon-btn"
                  onClick={() => remove(idx)}
                  title="Remove"
                >
                  ×
                </button>
              </div>
            );
          })}
        </div>
        <div className="db-modal-actions">
          <button className="db-btn" onClick={add}>
            + Add filter
          </button>
          {filters.length > 0 && (
            <button className="db-btn" onClick={() => onChange([])}>
              Clear all
            </button>
          )}
          <span style={{ flex: 1 }} />
          <button className="db-btn db-btn-primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function SettingsPopover({
  rowLimit,
  onRowLimitChange,
  onRemoveFromDoc,
  onClose,
}: {
  rowLimit: number | null;
  onRowLimitChange: (limit: number | null) => void;
  onRemoveFromDoc?: () => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(rowLimit ? String(rowLimit) : '');
  usePopoverClose(ref, onClose);

  function commitLimit() {
    const trimmed = draft.trim();
    if (!trimmed) {
      onRowLimitChange(null);
      return;
    }
    const n = parseInt(trimmed, 10);
    if (Number.isFinite(n) && n > 0) onRowLimitChange(n);
    else onRowLimitChange(null);
  }

  return (
    <div ref={ref} className="db-popover db-settings-popover">
      <div className="db-settings-section">
        <label className="db-settings-label">Max rows per view</label>
        <input
          autoFocus
          type="number"
          min={1}
          placeholder="unlimited"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commitLimit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              commitLimit();
              onClose();
            }
            if (e.key === 'Escape') onClose();
          }}
          className="db-settings-input"
        />
        <span className="db-settings-hint">Leave empty for unlimited.</span>
      </div>
      {onRemoveFromDoc && (
        <>
          <div className="db-popover-divider" />
          <button
            className="db-popover-item db-popover-danger"
            onClick={() => {
              onRemoveFromDoc();
              onClose();
            }}
          >
            <Trash2 size={12} /> Remove table from page
          </button>
        </>
      )}
    </div>
  );
}

export function DatabaseToolbar({
  schema,
  view,
  rowLimit,
  onAddRow,
  onSortChange,
  onColumnsChange,
  onFiltersChange,
  onRowLimitChange,
  onRemoveFromDoc,
}: Props) {
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  return (
    <div className="db-toolbar">
      <button className="db-btn db-btn-primary" onClick={onAddRow}>
        <Plus size={12} /> Add row
      </button>
      <button
        className={`db-btn ${filtersOpen || view.filters.length > 0 ? 'is-active' : ''}`}
        onClick={() => setFiltersOpen(true)}
      >
        <Filter size={12} /> Filter
        {view.filters.length > 0 ? ` (${view.filters.length})` : ''}
      </button>
      {filtersOpen && (
        <FiltersModal
          schema={schema}
          filters={view.filters}
          onChange={onFiltersChange}
          onClose={() => setFiltersOpen(false)}
        />
      )}
      <div className="db-popover-anchor">
        <button
          className={`db-btn ${sortOpen || view.sort ? 'is-active' : ''}`}
          onClick={() => setSortOpen((v) => !v)}
        >
          <ArrowUpDown size={12} /> Sort
          {view.sort
            ? ` · ${schema[view.sort.field]?.label ?? view.sort.field}`
            : ''}
        </button>
        {sortOpen && (
          <SortPopover
            schema={schema}
            sort={view.sort}
            onChange={onSortChange}
            onClose={() => setSortOpen(false)}
          />
        )}
      </div>
      <div className="db-popover-anchor">
        <button className="db-btn" onClick={() => setColumnsOpen((v) => !v)}>
          <Columns size={12} /> Columns
        </button>
        {columnsOpen && (
          <ColumnsPopover
            schema={schema}
            visible={view.visible_columns}
            onChange={onColumnsChange}
            onClose={() => setColumnsOpen(false)}
          />
        )}
      </div>
      <div className="db-popover-anchor" style={{ marginLeft: 'auto' }}>
        <button
          className="db-btn"
          title="Table settings"
          onClick={() => setSettingsOpen((v) => !v)}
        >
          <Settings size={12} />
        </button>
        {settingsOpen && (
          <SettingsPopover
            rowLimit={rowLimit}
            onRowLimitChange={onRowLimitChange}
            onRemoveFromDoc={onRemoveFromDoc}
            onClose={() => setSettingsOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
