import type {
  ColumnDef,
  ColumnType,
  FilterDef,
  FilterOp,
  Row,
  SortDef,
} from '@/types/database';

export function filterRows(
  rows: Row[],
  schema: Record<string, ColumnDef>,
  filters: FilterDef[],
): Row[] {
  if (!filters || filters.length === 0) return rows;
  return rows.filter((row) => filters.every((f) => matchFilter(row, schema, f)));
}

function matchFilter(row: Row, schema: Record<string, ColumnDef>, f: FilterDef): boolean {
  const colDef = schema[f.field];
  const v = row[f.field];

  switch (f.op) {
    case 'is_empty':
      return isEmpty(v);
    case 'is_not_empty':
      return !isEmpty(v);
    case 'eq':
      if (colDef?.type === 'checkbox') return Boolean(v) === Boolean(f.value);
      return String(v ?? '') === String(f.value ?? '');
    case 'neq':
      return String(v ?? '') !== String(f.value ?? '');
    case 'contains': {
      const fv = String(f.value ?? '').toLowerCase();
      if (Array.isArray(v)) return v.some((x) => String(x).toLowerCase().includes(fv));
      return String(v ?? '').toLowerCase().includes(fv);
    }
    case 'not_contains': {
      const fv = String(f.value ?? '').toLowerCase();
      if (Array.isArray(v)) return !v.some((x) => String(x).toLowerCase().includes(fv));
      return !String(v ?? '').toLowerCase().includes(fv);
    }
    case 'gt':
      return num(v) > num(f.value);
    case 'lt':
      return num(v) < num(f.value);
    case 'gte':
      return num(v) >= num(f.value);
    case 'lte':
      return num(v) <= num(f.value);
    case 'before':
      return String(v ?? '') < String(f.value ?? '');
    case 'after':
      return String(v ?? '') > String(f.value ?? '');
  }
  return true;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
}

function isEmpty(v: unknown): boolean {
  if (v === null || v === undefined || v === '') return true;
  if (Array.isArray(v) && v.length === 0) return true;
  return false;
}

export function sortRows(rows: Row[], sort: SortDef | null | undefined): Row[] {
  if (!sort) return rows;
  const { field, dir } = sort;
  const sign = dir === 'desc' ? -1 : 1;
  return [...rows].sort((a, b) => {
    const av = a[field];
    const bv = b[field];
    if (av === bv) return 0;
    if (av === undefined || av === null || av === '') return 1;
    if (bv === undefined || bv === null || bv === '') return -1;
    if (typeof av === 'number' && typeof bv === 'number') return (av - bv) * sign;
    return String(av).localeCompare(String(bv)) * sign;
  });
}

export function operatorsFor(t: ColumnType): { op: FilterOp; label: string; needsValue: boolean }[] {
  switch (t) {
    case 'text':
    case 'rich-text':
      return [
        { op: 'contains', label: 'contains', needsValue: true },
        { op: 'not_contains', label: 'does not contain', needsValue: true },
        { op: 'eq', label: 'is', needsValue: true },
        { op: 'neq', label: 'is not', needsValue: true },
        { op: 'is_empty', label: 'is empty', needsValue: false },
        { op: 'is_not_empty', label: 'is not empty', needsValue: false },
      ];
    case 'number':
      return [
        { op: 'eq', label: '=', needsValue: true },
        { op: 'neq', label: '≠', needsValue: true },
        { op: 'gt', label: '>', needsValue: true },
        { op: 'lt', label: '<', needsValue: true },
        { op: 'gte', label: '≥', needsValue: true },
        { op: 'lte', label: '≤', needsValue: true },
        { op: 'is_empty', label: 'is empty', needsValue: false },
      ];
    case 'select':
      return [
        { op: 'eq', label: 'is', needsValue: true },
        { op: 'neq', label: 'is not', needsValue: true },
        { op: 'is_empty', label: 'is empty', needsValue: false },
      ];
    case 'multi-select':
      return [
        { op: 'contains', label: 'contains', needsValue: true },
        { op: 'not_contains', label: 'does not contain', needsValue: true },
        { op: 'is_empty', label: 'is empty', needsValue: false },
      ];
    case 'checkbox':
      return [
        { op: 'eq', label: 'is checked', needsValue: false },
        { op: 'neq', label: 'is not checked', needsValue: false },
      ];
    case 'date':
      return [
        { op: 'eq', label: 'is', needsValue: true },
        { op: 'before', label: 'is before', needsValue: true },
        { op: 'after', label: 'is after', needsValue: true },
        { op: 'is_empty', label: 'is empty', needsValue: false },
      ];
  }
}
