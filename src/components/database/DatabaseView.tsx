import { useCallback, useEffect, useMemo, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import type { UnlistenFn } from '@tauri-apps/api/event';
import { dbApi } from '@/lib/database/api';
import type {
  ColumnDef,
  Database,
  FilterDef,
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

  // All mutation handlers below use functional setDb so they're immune to
  // stale closures: if a file-watcher reload or another mutation lands while
  // an async dbApi.* call is in flight, the new state is built off the
  // freshest snapshot, not the snapshot captured at handler creation. Before
  // this, a quick sequence of ghost-row additions could clobber each other
  // (each setDb wrote back its own captured `db` with only its own new row),
  // which looked like the table was "reformatting" itself.
  const persistView = useCallback(
    async (next: ViewDef) => {
      if (!resolvedViewId) return;
      setDb((prev) =>
        prev ? { ...prev, views: { ...prev.views, [resolvedViewId]: next } } : prev,
      );
      try {
        await dbApi.updateView(dbPath, resolvedViewId, next);
      } catch (err) {
        console.error(err);
      }
    },
    [dbPath, resolvedViewId],
  );

  const handleCellChange = useCallback(
    async (rowId: string, columnId: string, value: unknown) => {
      setDb((prev) => {
        if (!prev) return prev;
        const nextRows = prev.rows.map((r) =>
          r.id === rowId
            ? columnId === 'page'
              ? { ...r, page: (value as string | null) ?? null }
              : { ...r, [columnId]: value }
            : r,
        );
        return { ...prev, rows: nextRows };
      });
      try {
        await dbApi.updateCell(dbPath, rowId, columnId, value);
      } catch (err) {
        console.error(err);
        reload();
      }
    },
    [dbPath, reload],
  );

  const handleAddOption = useCallback(
    async (columnId: string, opt: string) => {
      let nextCol: ColumnDef | null = null;
      setDb((prev) => {
        if (!prev) return prev;
        const col = prev.schema[columnId];
        if (!col) return prev;
        const opts = col.options ?? [];
        if (opts.includes(opt)) return prev;
        nextCol = { ...col, options: [...opts, opt] };
        return { ...prev, schema: { ...prev.schema, [columnId]: nextCol } };
      });
      if (!nextCol) return;
      try {
        await dbApi.updateColumn(dbPath, columnId, nextCol);
      } catch (err) {
        console.error(err);
        reload();
      }
    },
    [dbPath, reload],
  );

  const handleSetOptionColor = useCallback(
    async (columnId: string, opt: string, hueIndex: number | null) => {
      let nextCol: ColumnDef | null = null;
      setDb((prev) => {
        if (!prev) return prev;
        const col = prev.schema[columnId];
        if (!col) return prev;
        const prevColors =
          (col.option_colors as Record<string, number> | undefined) ?? {};
        const colors = { ...prevColors };
        if (hueIndex === null) delete colors[opt];
        else colors[opt] = hueIndex;
        nextCol = { ...col, option_colors: colors };
        return { ...prev, schema: { ...prev.schema, [columnId]: nextCol } };
      });
      if (!nextCol) return;
      try {
        await dbApi.updateColumn(dbPath, columnId, nextCol);
      } catch (err) {
        console.error(err);
        reload();
      }
    },
    [dbPath, reload],
  );

  const handleAddRow = useCallback(async (): Promise<string | null> => {
    try {
      const id = await dbApi.addRow(dbPath);
      setDb((prev) =>
        prev ? { ...prev, rows: [...prev.rows, { id }] } : prev,
      );
      return id;
    } catch (err) {
      console.error(err);
      return null;
    }
  }, [dbPath]);

  const handleDeleteRow = useCallback(
    async (rowId: string) => {
      setDb((prev) =>
        prev ? { ...prev, rows: prev.rows.filter((r) => r.id !== rowId) } : prev,
      );
      try {
        await dbApi.deleteRow(dbPath, rowId);
      } catch (err) {
        console.error(err);
        reload();
      }
    },
    [dbPath, reload],
  );

  const handleAddColumn = useCallback(
    async (columnId: string, def: ColumnDef) => {
      let proceed = true;
      setDb((prev) => {
        if (!prev) return prev;
        if (prev.schema[columnId]) {
          alert(`Column "${columnId}" already exists`);
          proceed = false;
          return prev;
        }
        const nextSchema = { ...prev.schema, [columnId]: def };
        const nextViews: Record<string, ViewDef> = {};
        for (const [vid, vdef] of Object.entries(prev.views)) {
          nextViews[vid] = vdef.visible_columns.includes(columnId)
            ? vdef
            : { ...vdef, visible_columns: [...vdef.visible_columns, columnId] };
        }
        return { ...prev, schema: nextSchema, views: nextViews };
      });
      if (!proceed) return;
      setAddColumnOpen(false);
      try {
        await dbApi.addColumn(dbPath, columnId, def);
      } catch (err) {
        console.error(err);
        alert(String(err));
        reload();
      }
    },
    [dbPath, reload],
  );

  const handleRenameColumn = useCallback(
    async (columnId: string, label: string) => {
      let next: ColumnDef | null = null;
      setDb((prev) => {
        if (!prev) return prev;
        const col = prev.schema[columnId];
        if (!col) return prev;
        next = { ...col, label };
        return { ...prev, schema: { ...prev.schema, [columnId]: next } };
      });
      if (!next) return;
      try {
        await dbApi.updateColumn(dbPath, columnId, next);
      } catch (err) {
        console.error(err);
        reload();
      }
    },
    [dbPath, reload],
  );

  const handleDeleteColumn = useCallback(
    async (columnId: string) => {
      setDb((prev) => {
        if (!prev) return prev;
        const nextSchema = { ...prev.schema };
        delete nextSchema[columnId];
        const nextViews: Record<string, ViewDef> = {};
        for (const [vid, vdef] of Object.entries(prev.views)) {
          nextViews[vid] = {
            ...vdef,
            visible_columns: vdef.visible_columns.filter((c) => c !== columnId),
            filters: vdef.filters.filter((f) => f.field !== columnId),
            sort: vdef.sort && vdef.sort.field === columnId ? null : vdef.sort,
          };
        }
        const nextRows = prev.rows.map((r) => {
          if (!(columnId in r)) return r;
          const { [columnId]: _drop, ...rest } = r;
          return rest as typeof r;
        });
        return { ...prev, schema: nextSchema, views: nextViews, rows: nextRows };
      });
      try {
        await dbApi.deleteColumn(dbPath, columnId);
      } catch (err) {
        console.error(err);
        reload();
      }
    },
    [dbPath, reload],
  );

  const handleResizeColumn = useCallback(
    async (columnId: string, width: number) => {
      let next: ColumnDef | null = null;
      setDb((prev) => {
        if (!prev) return prev;
        const col = prev.schema[columnId];
        if (!col) return prev;
        next = { ...col, width };
        return { ...prev, schema: { ...prev.schema, [columnId]: next } };
      });
      if (!next) return;
      try {
        await dbApi.updateColumn(dbPath, columnId, next);
      } catch (err) {
        console.error(err);
      }
    },
    [dbPath],
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
        onAddRow={handleAddRow}
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
