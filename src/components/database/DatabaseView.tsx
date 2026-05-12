import { useCallback, useEffect, useMemo, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { dbApi } from '@/lib/database/api';
import type {
  ColumnDef,
  Database,
  FilterDef,
  Row,
  SortDef,
  ViewDef,
} from '@/types/database';
import { PAGE_COL } from '@/types/database';
import { filterRows, sortRows } from '@/lib/database/filtering';
import { DatabaseToolbar } from './DatabaseToolbar';
import { DatabaseTable } from './DatabaseTable';
import { AddColumnPopover } from './AddColumnPopover';

interface Props {
  dbPath: string;
  viewId?: string;
  onRemoveFromDoc?: () => void;
  /// Rewrite the `view:` line in the host fence so it points at a new view id.
  /// The widget host (CodeMirror) supplies this; without it the view selector
  /// falls back to read-only behavior because we can't redirect the fence.
  onChangeViewId?: (newViewId: string) => void;
}

interface ErrorState {
  kind: 'not_found' | 'parse' | 'view_missing';
  message: string;
}

export function DatabaseView({
  dbPath,
  viewId,
  onRemoveFromDoc,
  onChangeViewId,
}: Props) {
  const [db, setDb] = useState<Database | null>(null);
  const [error, setError] = useState<ErrorState | null>(null);
  const [addColumnOpen, setAddColumnOpen] = useState(false);
  const [reloadTick, setReloadTick] = useState(0);

  const reload = useCallback(() => setReloadTick((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    dbApi
      .read(dbPath)
      .then((data) => {
        if (!cancelled) setDb(data);
      })
      .catch((err) => {
        if (cancelled) return;
        const msg = String(err);
        if (msg.toLowerCase().includes('failed to read')) {
          setError({ kind: 'not_found', message: msg });
        } else {
          setError({ kind: 'parse', message: msg });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [dbPath, reloadTick]);

  // Listen for external file changes (FS watcher emits 'vault:file-changed')
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    void listen<{ path: string }>('vault:file-changed', (e) => {
      if (e.payload?.path === dbPath) reload();
    }).then((fn) => {
      unlisten = fn;
    });
    return () => {
      unlisten?.();
    };
  }, [dbPath, reload]);

  // When the fence specifies a view that doesn't exist in the file yet, keep
  // the requested id as the "resolved" id and synthesize a fresh ViewDef from
  // the default view. This lets each fence own its own filters — the first
  // edit will persist a new ViewDef under that id.
  const resolvedViewId = useMemo(() => {
    if (!db) return null;
    const ids = Object.keys(db.views);
    if (viewId) return viewId;
    if (ids.length === 0) return null;
    return ids[0];
  }, [db, viewId]);

  const view: ViewDef | null = useMemo(() => {
    if (!db || !resolvedViewId) return null;
    const existing = db.views[resolvedViewId];
    if (existing) return existing;
    const fallback = Object.values(db.views)[0];
    if (fallback) {
      return {
        ...fallback,
        label: resolvedViewId,
        filters: [],
        sort: null,
      };
    }
    return {
      label: resolvedViewId,
      visible_columns: [PAGE_COL, ...Object.keys(db.schema)],
      filters: [],
      sort: null,
    };
  }, [db, resolvedViewId]);

  const visibleRows = useMemo(() => {
    if (!db || !view) return [];
    const filtered = filterRows(db.rows, db.schema, view.filters);
    const sorted = sortRows(filtered, view.sort);
    const limit = view.row_limit;
    return limit && limit > 0 ? sorted.slice(0, limit) : sorted;
  }, [db, view]);

  const persistView = useCallback(
    async (next: ViewDef) => {
      if (!db || !resolvedViewId) return;
      setDb({ ...db, views: { ...db.views, [resolvedViewId]: next } });
      try {
        await dbApi.updateView(dbPath, resolvedViewId, next);
      } catch (err) {
        console.error(err);
      }
    },
    [db, dbPath, resolvedViewId],
  );

  const handleCellChange = useCallback(
    async (rowId: string, columnId: string, value: unknown) => {
      if (!db) return;
      const nextRows = db.rows.map((r) =>
        r.id === rowId
          ? columnId === 'page'
            ? { ...r, page: (value as string | null) ?? null }
            : { ...r, [columnId]: value }
          : r,
      );
      setDb({ ...db, rows: nextRows });
      try {
        await dbApi.updateCell(dbPath, rowId, columnId, value);
      } catch (err) {
        console.error(err);
        reload();
      }
    },
    [db, dbPath, reload],
  );

  const handleAddOption = useCallback(
    async (columnId: string, opt: string) => {
      if (!db) return;
      const col = db.schema[columnId];
      if (!col) return;
      const opts = col.options ?? [];
      if (opts.includes(opt)) return;
      const nextCol: ColumnDef = { ...col, options: [...opts, opt] };
      setDb({ ...db, schema: { ...db.schema, [columnId]: nextCol } });
      try {
        await dbApi.updateColumn(dbPath, columnId, nextCol);
      } catch (err) {
        console.error(err);
        reload();
      }
    },
    [db, dbPath, reload],
  );

  const handleSetOptionColor = useCallback(
    async (columnId: string, opt: string, hueIndex: number | null) => {
      if (!db) return;
      const col = db.schema[columnId];
      if (!col) return;
      const prev = (col.option_colors as Record<string, number> | undefined) ?? {};
      const next = { ...prev };
      if (hueIndex === null) delete next[opt];
      else next[opt] = hueIndex;
      const nextCol: ColumnDef = { ...col, option_colors: next };
      setDb({ ...db, schema: { ...db.schema, [columnId]: nextCol } });
      try {
        await dbApi.updateColumn(dbPath, columnId, nextCol);
      } catch (err) {
        console.error(err);
        reload();
      }
    },
    [db, dbPath, reload],
  );

  const handleAddRow = useCallback(async () => {
    if (!db) return;
    try {
      const id = await dbApi.addRow(dbPath);
      const newRow: Row = { id };
      setDb({ ...db, rows: [...db.rows, newRow] });
    } catch (err) {
      console.error(err);
    }
  }, [db, dbPath]);

  const handleDeleteRow = useCallback(
    async (rowId: string) => {
      if (!db) return;
      setDb({ ...db, rows: db.rows.filter((r) => r.id !== rowId) });
      try {
        await dbApi.deleteRow(dbPath, rowId);
      } catch (err) {
        console.error(err);
        reload();
      }
    },
    [db, dbPath, reload],
  );

  const handleAddColumn = useCallback(
    async (columnId: string, def: ColumnDef) => {
      if (!db) return;
      if (db.schema[columnId]) {
        alert(`Column "${columnId}" already exists`);
        return;
      }
      const nextSchema = { ...db.schema, [columnId]: def };
      const nextViews: Record<string, ViewDef> = {};
      for (const [vid, vdef] of Object.entries(db.views)) {
        nextViews[vid] = vdef.visible_columns.includes(columnId)
          ? vdef
          : { ...vdef, visible_columns: [...vdef.visible_columns, columnId] };
      }
      setDb({ ...db, schema: nextSchema, views: nextViews });
      setAddColumnOpen(false);
      try {
        await dbApi.addColumn(dbPath, columnId, def);
      } catch (err) {
        console.error(err);
        alert(String(err));
        reload();
      }
    },
    [db, dbPath, reload],
  );

  const handleRenameColumn = useCallback(
    async (columnId: string, label: string) => {
      if (!db) return;
      const col = db.schema[columnId];
      if (!col) return;
      const next = { ...col, label };
      setDb({ ...db, schema: { ...db.schema, [columnId]: next } });
      try {
        await dbApi.updateColumn(dbPath, columnId, next);
      } catch (err) {
        console.error(err);
        reload();
      }
    },
    [db, dbPath, reload],
  );

  const handleDeleteColumn = useCallback(
    async (columnId: string) => {
      if (!db) return;
      const nextSchema = { ...db.schema };
      delete nextSchema[columnId];
      const nextViews: Record<string, ViewDef> = {};
      for (const [vid, vdef] of Object.entries(db.views)) {
        nextViews[vid] = {
          ...vdef,
          visible_columns: vdef.visible_columns.filter((c) => c !== columnId),
          filters: vdef.filters.filter((f) => f.field !== columnId),
          sort: vdef.sort && vdef.sort.field === columnId ? null : vdef.sort,
        };
      }
      const nextRows = db.rows.map((r) => {
        if (!(columnId in r)) return r;
        const { [columnId]: _drop, ...rest } = r;
        return rest as typeof r;
      });
      setDb({ ...db, schema: nextSchema, views: nextViews, rows: nextRows });
      try {
        await dbApi.deleteColumn(dbPath, columnId);
      } catch (err) {
        console.error(err);
        reload();
      }
    },
    [db, dbPath, reload],
  );

  const handleResizeColumn = useCallback(
    async (columnId: string, width: number) => {
      if (!db) return;
      const col = db.schema[columnId];
      if (!col) return;
      const next = { ...col, width };
      setDb({ ...db, schema: { ...db.schema, [columnId]: next } });
      try {
        await dbApi.updateColumn(dbPath, columnId, next);
      } catch (err) {
        console.error(err);
      }
    },
    [db, dbPath],
  );

  const handleSortColumn = useCallback(
    (columnId: string, dir: 'asc' | 'desc' | null) => {
      if (!view) return;
      const next: ViewDef = {
        ...view,
        sort: dir ? { field: columnId, dir } : null,
      };
      void persistView(next);
    },
    [view, persistView],
  );

  const handleSortChange = useCallback(
    (sort: SortDef | null) => {
      if (!view) return;
      void persistView({ ...view, sort });
    },
    [view, persistView],
  );

  const handleColumnsChange = useCallback(
    (visibleColumns: string[]) => {
      if (!view) return;
      void persistView({ ...view, visible_columns: visibleColumns });
    },
    [view, persistView],
  );

  const handleFiltersChange = useCallback(
    (filters: FilterDef[]) => {
      if (!view) return;
      void persistView({ ...view, filters });
    },
    [view, persistView],
  );

  const handleRowLimitChange = useCallback(
    (limit: number | null) => {
      if (!view) return;
      void persistView({ ...view, row_limit: limit });
    },
    [view, persistView],
  );

  if (error) {
    if (error.kind === 'not_found') {
      return (
        <div className="db-error">
          <span>Database not found: {dbPath}</span>
          <button
            className="db-btn db-btn-primary"
            onClick={async () => {
              try {
                await dbApi.create(dbPath);
                reload();
              } catch (err) {
                alert(String(err));
              }
            }}
          >
            Create
          </button>
        </div>
      );
    }
    return (
      <div className="db-error">
        <span>Cannot parse database file: {dbPath}</span>
        <span className="db-error-detail">{error.message}</span>
      </div>
    );
  }

  if (!db) {
    return <div className="db-loading">Loading…</div>;
  }

  if (!view || !resolvedViewId) {
    return <div className="db-error">No views defined in this database.</div>;
  }

  return (
    <div className="db-root">
      <DatabaseToolbar
        schema={db.schema}
        view={view}
        viewId={resolvedViewId}
        allViews={db.views}
        rowLimit={view.row_limit ?? null}
        onAddRow={handleAddRow}
        onSortChange={handleSortChange}
        onColumnsChange={handleColumnsChange}
        onFiltersChange={handleFiltersChange}
        onRowLimitChange={handleRowLimitChange}
        onRemoveFromDoc={onRemoveFromDoc}
        onSwitchView={onChangeViewId}
        onCreateView={
          onChangeViewId
            ? async (label) => {
                const newId = `view-${Math.random().toString(36).slice(2, 8)}`;
                // Clone the current view (filters, columns, sort, limit) so the
                // user immediately sees the same configuration and can diverge
                // from there.
                const clone: ViewDef = { ...view, label: label || 'New view' };
                try {
                  await dbApi.updateView(dbPath, newId, clone);
                  setDb((prev) =>
                    prev ? { ...prev, views: { ...prev.views, [newId]: clone } } : prev,
                  );
                  onChangeViewId(newId);
                } catch (err) {
                  console.error(err);
                  alert(String(err));
                }
              }
            : undefined
        }
        onRenameView={
          resolvedViewId
            ? async (label) => {
                if (!view) return;
                await persistView({ ...view, label });
              }
            : undefined
        }
      />
      <DatabaseTable
        dbPath={dbPath}
        schema={db.schema}
        view={view}
        rows={visibleRows}
        onCellChange={handleCellChange}
        onAddOption={handleAddOption}
        onSetOptionColor={handleSetOptionColor}
        onDeleteRow={handleDeleteRow}
        onAddColumnClick={() => setAddColumnOpen((v) => !v)}
        onRenameColumn={handleRenameColumn}
        onDeleteColumn={handleDeleteColumn}
        onResizeColumn={handleResizeColumn}
        onSortColumn={handleSortColumn}
        onRowReload={reload}
      />
      {addColumnOpen && (
        <AddColumnPopover
          existingIds={new Set(Object.keys(db.schema))}
          onSubmit={handleAddColumn}
          onClose={() => setAddColumnOpen(false)}
        />
      )}
      <div className="db-footer">
        {visibleRows.length} of {db.rows.length} rows
        {view.row_limit ? ` (limit ${view.row_limit})` : ''}
      </div>
    </div>
  );
}

// PAGE_COL re-export so other modules can import from same place if desired.
export { PAGE_COL };
