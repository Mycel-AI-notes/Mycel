export type ColumnType =
  | 'text'
  | 'number'
  | 'select'
  | 'multi-select'
  | 'checkbox'
  | 'date'
  | 'rich-text';

export interface ColumnDef {
  type: ColumnType;
  label: string;
  options?: string[];
  width?: number;
  /// Read-only columns can't be edited from the UI — used for auto-derived
  /// fields like KB `area` that the backend overwrites on every refresh.
  readonly?: boolean;
  [extra: string]: unknown;
}

export interface SortDef {
  field: string;
  dir: 'asc' | 'desc';
}

export type FilterOp =
  | 'eq'
  | 'neq'
  | 'contains'
  | 'not_contains'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'is_empty'
  | 'is_not_empty'
  | 'before'
  | 'after';

export interface FilterDef {
  field: string;
  op: FilterOp;
  value?: unknown;
}

export interface ViewDef {
  label: string;
  visible_columns: string[];
  sort?: SortDef | null;
  filters: FilterDef[];
  /// Optional max rows shown in this view. null/absent means unlimited.
  row_limit?: number | null;
  [extra: string]: unknown;
}

export interface Row {
  id: string;
  page?: string | null;
  [columnId: string]: unknown;
}

export interface Database {
  version: number;
  pages_dir?: string | null;
  schema: Record<string, ColumnDef>;
  views: Record<string, ViewDef>;
  rows: Row[];
  [extra: string]: unknown;
}

export const PAGE_COL = '__page__';
