import type { ColumnDef, Row } from '@/types/database';
import { TextCell } from './cells/TextCell';
import { NumberCell } from './cells/NumberCell';
import { CheckboxCell } from './cells/CheckboxCell';
import { DateCell } from './cells/DateCell';
import { SelectCell } from './cells/SelectCell';
import { MultiSelectCell } from './cells/MultiSelectCell';
import { RichTextCell } from './cells/RichTextCell';
import { PageLinkCell } from './cells/PageLinkCell';
import { PAGE_COL } from '@/types/database';

interface Props {
  dbPath: string;
  row: Row;
  columnId: string;
  column?: ColumnDef;
  editing: boolean;
  onCommit: () => void;
  onCellChange: (rowId: string, columnId: string, value: unknown) => void | Promise<void>;
  onAddOption: (columnId: string, opt: string) => void | Promise<void>;
  onSetOptionColor: (columnId: string, opt: string, hueIndex: number | null) => void | Promise<void>;
  onRowReload: () => void;
}

export function DatabaseCell({
  dbPath,
  row,
  columnId,
  column,
  editing,
  onCommit,
  onCellChange,
  onAddOption,
  onSetOptionColor,
  onRowReload,
}: Props) {
  if (columnId === PAGE_COL) {
    return <PageLinkCell dbPath={dbPath} row={row} onChanged={onRowReload} />;
  }

  if (!column) return null;

  const value = row[columnId];

  switch (column.type) {
    case 'text':
      return (
        <TextCell
          value={(value as string) ?? ''}
          editing={editing}
          onChange={(v) => onCellChange(row.id, columnId, v)}
          onCommit={onCommit}
        />
      );
    case 'number':
      return (
        <NumberCell
          value={(value as number) ?? null}
          editing={editing}
          onChange={(v) => onCellChange(row.id, columnId, v)}
          onCommit={onCommit}
        />
      );
    case 'checkbox':
      return (
        <CheckboxCell
          value={Boolean(value)}
          onChange={(v) => onCellChange(row.id, columnId, v)}
        />
      );
    case 'date':
      return (
        <DateCell
          value={(value as string) ?? null}
          editing={editing}
          onChange={(v) => onCellChange(row.id, columnId, v)}
          onCommit={onCommit}
        />
      );
    case 'select':
      return (
        <SelectCell
          value={(value as string) ?? null}
          options={column.options ?? []}
          optionColors={column.option_colors as Record<string, number> | undefined}
          editing={editing}
          onChange={(v) => onCellChange(row.id, columnId, v)}
          onAddOption={(o) => onAddOption(columnId, o)}
          onSetOptionColor={(opt, hue) => onSetOptionColor(columnId, opt, hue)}
          onCommit={onCommit}
        />
      );
    case 'multi-select':
      return (
        <MultiSelectCell
          value={Array.isArray(value) ? (value as string[]) : []}
          options={column.options ?? []}
          optionColors={column.option_colors as Record<string, number> | undefined}
          editing={editing}
          onChange={(v) => onCellChange(row.id, columnId, v)}
          onAddOption={(o) => onAddOption(columnId, o)}
          onSetOptionColor={(opt, hue) => onSetOptionColor(columnId, opt, hue)}
          onCommit={onCommit}
        />
      );
    case 'rich-text':
      return (
        <RichTextCell
          value={(value as string) ?? ''}
          editing={editing}
          onChange={(v) => onCellChange(row.id, columnId, v)}
          onCommit={onCommit}
        />
      );
  }
}
