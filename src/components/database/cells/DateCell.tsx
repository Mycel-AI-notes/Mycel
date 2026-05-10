import { useEffect, useRef } from 'react';

interface Props {
  value: string | null;
  editing: boolean;
  onChange: (next: string | null) => void;
  onCommit: () => void;
}

export function DateCell({ value, editing, onChange, onCommit }: Props) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      requestAnimationFrame(() => ref.current?.focus());
    }
  }, [editing]);

  if (!editing) {
    return <span className="db-cell-text">{value || ''}</span>;
  }

  return (
    <input
      ref={ref}
      type="date"
      className="db-cell-input"
      value={value ?? ''}
      onChange={(e) => onChange(e.target.value || null)}
      onBlur={onCommit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === 'Escape') {
          e.preventDefault();
          onCommit();
        }
      }}
    />
  );
}
