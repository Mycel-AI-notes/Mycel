import { useEffect, useRef, useState } from 'react';

interface Props {
  value: string;
  editing: boolean;
  onChange: (next: string) => void;
  onCommit: () => void;
}

export function TextCell({ value, editing, onChange, onCommit }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value ?? '');

  useEffect(() => {
    if (editing) {
      setDraft(value ?? '');
      requestAnimationFrame(() => ref.current?.focus());
    }
  }, [editing, value]);

  if (!editing) {
    return <span className="db-cell-text">{value || ''}</span>;
  }

  return (
    <input
      ref={ref}
      type="text"
      className="db-cell-input"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        onChange(draft);
        onCommit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onChange(draft);
          onCommit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCommit();
        }
      }}
    />
  );
}
