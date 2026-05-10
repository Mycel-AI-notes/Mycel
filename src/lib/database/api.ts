import { invoke } from '@tauri-apps/api/core';
import type { ColumnDef, Database, Row, ViewDef } from '@/types/database';

export const dbApi = {
  read: (path: string) => invoke<Database>('db_read', { path }),
  write: (path: string, database: Database) =>
    invoke<void>('db_write', { path, database }),
  create: (path: string) => invoke<Database>('db_create', { path }),
  updateCell: (path: string, rowId: string, columnId: string, value: unknown) =>
    invoke<void>('db_update_cell', { path, rowId, columnId, value }),
  addRow: (path: string, row?: Partial<Row>) =>
    invoke<string>('db_add_row', { path, row: row ?? null }),
  deleteRow: (path: string, rowId: string) =>
    invoke<void>('db_delete_row', { path, rowId }),
  addColumn: (path: string, columnId: string, columnDef: ColumnDef) =>
    invoke<void>('db_add_column', { path, columnId, columnDef }),
  deleteColumn: (path: string, columnId: string) =>
    invoke<void>('db_delete_column', { path, columnId }),
  updateColumn: (path: string, columnId: string, columnDef: ColumnDef) =>
    invoke<void>('db_update_column', { path, columnId, columnDef }),
  updateView: (path: string, viewId: string, viewDef: ViewDef) =>
    invoke<void>('db_update_view', { path, viewId, viewDef }),
  createPage: (dbPath: string, rowId: string, notePath: string) =>
    invoke<void>('db_create_page', { dbPath, rowId, notePath }),
};
