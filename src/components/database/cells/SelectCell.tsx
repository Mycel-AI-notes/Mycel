import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAnchorPos, useClickOutside } from '../floating';

interface Props {
  value: string | null;
  options: string[];
  editing: boolean;
  onChange: (next: string | null) => void;
  onAddOption: (opt: string) => void;
  onCommit: () => void;
}

export function SelectCell({
  value,
  options,
  editing,
  onChange,
  onAddOption,
  onCommit,
}: Props) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const pos = useAnchorPos(anchorRef, editing);
  useClickOutside([anchorRef, popRef], editing, onCommit);

  const filtered = options.filter((o) =>
    o.toLowerCase().includes(query.toLowerCase()),
  );
  const showCreate =
    query.trim() && !options.some((o) => o.toLowerCase() === query.toLowerCase());

  return (
    <>
      <div ref={anchorRef} className="db-cell-anchor">
        {value ? (
          <span className="db-tag">{value}</span>
        ) : (
          <span className="db-cell-text" />
        )}
      </div>
      {editing &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            className="db-popover db-cell-popover"
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              minWidth: Math.max(180, pos.minWidth),
              zIndex: 60,
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
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
                  if (filtered[0]) {
                    onChange(filtered[0]);
                    onCommit();
                  } else if (showCreate) {
                    onAddOption(query.trim());
                    onChange(query.trim());
                    onCommit();
                  }
                }
              }}
            />
            <div className="db-popover-list">
              {value && (
                <button
                  className="db-popover-item db-popover-clear"
                  onClick={() => {
                    onChange(null);
                    onCommit();
                  }}
                >
                  Clear
                </button>
              )}
              {filtered.map((o) => (
                <button
                  key={o}
                  className="db-popover-item"
                  onClick={() => {
                    onChange(o);
                    onCommit();
                  }}
                >
                  <span className="db-tag">{o}</span>
                </button>
              ))}
              {showCreate && (
                <button
                  className="db-popover-item"
                  onClick={() => {
                    onAddOption(query.trim());
                    onChange(query.trim());
                    onCommit();
                  }}
                >
                  + Create "{query.trim()}"
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
