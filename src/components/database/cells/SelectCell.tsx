import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Palette } from 'lucide-react';
import { useAnchorPos, useClickOutside } from '../floating';
import { tagStyle } from './tagColor';
import { TagColorSwatches } from './TagColorSwatches';

interface Props {
  value: string | null;
  options: string[];
  optionColors?: Record<string, number>;
  editing: boolean;
  onChange: (next: string | null) => void;
  onAddOption: (opt: string) => void;
  onSetOptionColor: (opt: string, hueIndex: number | null) => void;
  onCommit: () => void;
}

export function SelectCell({
  value,
  options,
  optionColors,
  editing,
  onChange,
  onAddOption,
  onSetOptionColor,
  onCommit,
}: Props) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [query, setQuery] = useState('');
  const [paletteFor, setPaletteFor] = useState<string | null>(null);
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
          <span className="db-tag" style={tagStyle(value, optionColors)}>{value}</span>
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
                <div key={o} className="db-popover-item db-popover-item-row">
                  <button
                    className="db-popover-item-main"
                    onClick={() => {
                      onChange(o);
                      onCommit();
                    }}
                  >
                    <span className="db-tag" style={tagStyle(o, optionColors)}>
                      {o}
                    </span>
                  </button>
                  <button
                    className={`db-icon-btn db-tag-color-toggle ${
                      paletteFor === o ? 'is-active' : ''
                    }`}
                    title="Change color"
                    onClick={(e) => {
                      e.stopPropagation();
                      setPaletteFor(paletteFor === o ? null : o);
                    }}
                  >
                    <Palette size={12} />
                  </button>
                  {paletteFor === o && (
                    <div className="db-tag-swatches-row">
                      <TagColorSwatches
                        current={optionColors?.[o]}
                        onPick={(hue) => {
                          onSetOptionColor(o, hue);
                          setPaletteFor(null);
                        }}
                      />
                    </div>
                  )}
                </div>
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
