import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Palette } from 'lucide-react';
import { useAnchorPos, useClickOutside } from '../floating';
import { tagStyle } from './tagColor';
import { TagColorSwatches } from './TagColorSwatches';

interface Props {
  value: string[];
  options: string[];
  optionColors?: Record<string, number>;
  editing: boolean;
  onChange: (next: string[]) => void;
  onAddOption: (opt: string) => void;
  onSetOptionColor: (opt: string, hueIndex: number | null) => void;
  onCommit: () => void;
}

export function MultiSelectCell({
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

  const selected = new Set(value ?? []);
  const filtered = options.filter((o) =>
    o.toLowerCase().includes(query.toLowerCase()),
  );
  const showCreate =
    query.trim() && !options.some((o) => o.toLowerCase() === query.toLowerCase());

  function toggle(o: string) {
    const next = new Set(selected);
    if (next.has(o)) next.delete(o);
    else next.add(o);
    onChange([...next]);
  }

  return (
    <>
      <div ref={anchorRef} className="db-cell-anchor">
        <div className="db-tag-row">
          {(value ?? []).map((v) => (
            <span key={v} className="db-tag" style={tagStyle(v, optionColors)}>
              {v}
            </span>
          ))}
        </div>
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
              minWidth: Math.max(220, pos.minWidth),
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
                <div
                  key={o}
                  className={`db-popover-item db-popover-item-row ${selected.has(o) ? 'is-active' : ''}`}
                >
                  <button
                    className="db-popover-item-main"
                    onClick={() => toggle(o)}
                  >
                    <input type="checkbox" checked={selected.has(o)} readOnly />
                    <span className="db-tag" style={tagStyle(o, optionColors)}>{o}</span>
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
          </div>,
          document.body,
        )}
    </>
  );
}
