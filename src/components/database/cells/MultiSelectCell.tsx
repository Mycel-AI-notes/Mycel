import { useEffect, useRef, useState } from 'react';

interface Props {
  value: string[];
  options: string[];
  editing: boolean;
  onChange: (next: string[]) => void;
  onAddOption: (opt: string) => void;
  onCommit: () => void;
}

export function MultiSelectCell({
  value,
  options,
  editing,
  onChange,
  onAddOption,
  onCommit,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const selected = new Set(value ?? []);

  useEffect(() => {
    if (!editing) return;
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onCommit();
    }
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [editing, onCommit]);

  if (!editing) {
    return (
      <div className="db-tag-row">
        {(value ?? []).map((v) => (
          <span key={v} className="db-tag">
            {v}
          </span>
        ))}
      </div>
    );
  }

  const filtered = options.filter((o) => o.toLowerCase().includes(query.toLowerCase()));
  const showCreate = query.trim() && !options.some((o) => o.toLowerCase() === query.toLowerCase());

  function toggle(o: string) {
    const next = new Set(selected);
    if (next.has(o)) next.delete(o);
    else next.add(o);
    onChange([...next]);
  }

  return (
    <div ref={ref} className="db-popover">
      <input
        autoFocus
        className="db-popover-input"
        placeholder="Search…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onCommit();
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            if (showCreate) {
              onAddOption(query.trim());
              const next = new Set(selected);
              next.add(query.trim());
              onChange([...next]);
              setQuery('');
            } else if (filtered[0]) {
              toggle(filtered[0]);
              setQuery('');
            }
          }
        }}
      />
      <div className="db-popover-list">
        {filtered.map((o) => (
          <button
            key={o}
            className={`db-popover-item ${selected.has(o) ? 'is-active' : ''}`}
            onClick={() => toggle(o)}
          >
            <input type="checkbox" checked={selected.has(o)} readOnly />
            <span className="db-tag">{o}</span>
          </button>
        ))}
        {showCreate && (
          <button
            className="db-popover-item"
            onClick={() => {
              onAddOption(query.trim());
              const next = new Set(selected);
              next.add(query.trim());
              onChange([...next]);
              setQuery('');
            }}
          >
            + Create "{query.trim()}"
          </button>
        )}
      </div>
    </div>
  );
}
