import { useEffect, useRef, useState } from 'react';

interface Props {
  value: number | null;
  editing: boolean;
  onChange: (next: number | null) => void;
  onCommit: () => void;
}

export function NumberCell({ value, editing, onChange, onCommit }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value === null || value === undefined ? '' : String(value));

  useEffect(() => {
    if (editing) {
      setDraft(value === null || value === undefined ? '' : String(value));
      requestAnimationFrame(() => ref.current?.focus());
    }
  }, [editing, value]);

  if (!editing) {
    return <span className="db-cell-text db-cell-num">{value === null || value === undefined ? '' : value}</span>;
  }

  return (
    <input
      ref={ref}
      type="number"
      className="db-cell-input db-cell-num"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        const trimmed = draft.trim();
        const parsed = trimmed === '' ? null : Number(trimmed);
        onChange(parsed === null || Number.isFinite(parsed) ? parsed : null);
        onCommit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCommit();
        }
      }}
    />
  );
}
