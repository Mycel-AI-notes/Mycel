import { useEffect, useRef, useState } from 'react';
import { Plus, Filter, ArrowUpDown, Columns, Settings } from 'lucide-react';
import type { ColumnDef, SortDef, ViewDef } from '@/types/database';
import { PAGE_COL } from '@/types/database';

interface Props {
  schema: Record<string, ColumnDef>;
  view: ViewDef;
  filterCount: number;
  filtersOpen: boolean;
  pagesDir: string | null;
  onAddRow: () => void;
  onToggleFilters: () => void;
  onSortChange: (sort: SortDef | null) => void;
  onColumnsChange: (visibleColumns: string[]) => void;
  onPagesDirChange: (dir: string | null) => void;
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

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  function toggle(id: string) {
    if (visible.includes(id)) onChange(visible.filter((c) => c !== id));
    else onChange([...visible, id]);
  }

  const knownIds = new Set(Object.keys(schema));
  knownIds.add(PAGE_COL);
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
  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

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

function SettingsPopover({
  pagesDir,
  onChange,
  onClose,
}: {
  pagesDir: string | null;
  onChange: (dir: string | null) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState(pagesDir ?? '');

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  function commit() {
    const trimmed = draft.trim().replace(/^\/+|\/+$/g, '');
    onChange(trimmed || null);
    onClose();
  }

  return (
    <div ref={ref} className="db-popover db-settings-popover">
      <div className="db-popover-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
        <label style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
          Pages folder (relative to vault)
        </label>
        <input
          autoFocus
          value={draft}
          placeholder="leave empty for default"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') onClose();
          }}
          style={{
            padding: '6px 8px',
            border: '1px solid var(--color-border)',
            borderRadius: 4,
            background: 'var(--color-surface-1)',
            color: 'var(--color-text-primary)',
            fontSize: 12,
          }}
        />
        <span style={{ fontSize: 11, color: 'var(--color-text-muted)' }}>
          Default: subfolder named after the database file.
        </span>
      </div>
      <button className="db-popover-item" onClick={commit}>
        Save
      </button>
    </div>
  );
}

export function DatabaseToolbar({
  schema,
  view,
  filterCount,
  filtersOpen,
  pagesDir,
  onAddRow,
  onToggleFilters,
  onSortChange,
  onColumnsChange,
  onPagesDirChange,
}: Props) {
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [sortOpen, setSortOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <div className="db-toolbar">
      <button className="db-btn db-btn-primary" onClick={onAddRow}>
        <Plus size={12} /> Add row
      </button>
      <button
        className={`db-btn ${filtersOpen || filterCount > 0 ? 'is-active' : ''}`}
        onClick={onToggleFilters}
      >
        <Filter size={12} /> Filter{filterCount > 0 ? ` (${filterCount})` : ''}
      </button>
      <div className="db-popover-anchor">
        <button
          className={`db-btn ${sortOpen || view.sort ? 'is-active' : ''}`}
          onClick={() => setSortOpen((v) => !v)}
        >
          <ArrowUpDown size={12} /> Sort{view.sort ? ` · ${schema[view.sort.field]?.label ?? view.sort.field}` : ''}
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
          title="Database settings"
          onClick={() => setSettingsOpen((v) => !v)}
        >
          <Settings size={12} />
        </button>
        {settingsOpen && (
          <SettingsPopover
            pagesDir={pagesDir}
            onChange={onPagesDirChange}
            onClose={() => setSettingsOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
