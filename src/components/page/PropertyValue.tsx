import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, Palette, X } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useAnchorPos, useClickOutside } from '@/components/database/floating';
import { tagStyle } from '@/components/database/cells/tagColor';
import { TagColorSwatches } from '@/components/database/cells/TagColorSwatches';
import { usePropertiesStore, usePropertyDef } from '@/stores/properties';
import type { PropType, PropValue } from '@/lib/page-meta';

interface Props {
  name: string;
  type: PropType;
  value: PropValue;
  onChange: (next: PropValue) => void;
}

/** The value cell of a property row: reads as text until clicked, then turns
 *  into the editor for its type. Text-like editors commit on Enter / blur,
 *  not per keystroke, so the frontmatter isn't rewritten while typing. */
export function PropertyValue({ name, type, value, onChange }: Props) {
  switch (type) {
    case 'checkbox':
      return (
        <label className="myc-prop-value myc-prop-checkbox">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => onChange(e.target.checked)}
          />
        </label>
      );
    case 'select':
    case 'multi-select':
      return <ChoiceValue name={name} multi={type === 'multi-select'} value={value} onChange={onChange} />;
    default:
      return <TextualValue type={type} value={value} onChange={onChange} />;
  }
}

function formatDate(v: string): string {
  const hasTime = /[T ]\d{2}:\d{2}/.test(v);
  const d = new Date(hasTime ? v.replace(' ', 'T') : `${v}T00:00`);
  if (Number.isNaN(d.getTime())) return v;
  return d.toLocaleString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    ...(hasTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  });
}

function TextualValue({
  type,
  value,
  onChange,
}: {
  type: PropType;
  value: PropValue;
  onChange: (next: PropValue) => void;
}) {
  const [editing, setEditing] = useState(false);
  const text = value === null ? '' : Array.isArray(value) ? value.join(', ') : String(value);
  const [draft, setDraft] = useState(text);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      setDraft(text);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const isDateTime = type === 'date' && /[T ]\d{2}:\d{2}/.test(text);

  const commit = (raw: string) => {
    setEditing(false);
    const v = raw.trim();
    if (v === text) return;
    if (type === 'number') {
      const n = Number(v);
      onChange(v === '' || !Number.isFinite(n) ? null : n);
    } else if (type === 'date') {
      // Keep the frontmatter in the familiar `YYYY-MM-DD HH:mm` shape rather
      // than the input's `T` separator.
      onChange(v === '' ? null : v.replace('T', ' '));
    } else {
      onChange(v === '' ? null : v);
    }
  };

  if (editing) {
    return (
      <input
        ref={inputRef}
        className="myc-prop-input"
        type={type === 'number' ? 'number' : type === 'date' ? (isDateTime ? 'datetime-local' : 'date') : 'text'}
        value={type === 'date' ? draft.replace(' ', 'T').slice(0, isDateTime ? 16 : 10) : draft}
        placeholder={type === 'url' ? 'https://' : 'Empty'}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            commit((e.target as HTMLInputElement).value);
          }
          if (e.key === 'Escape') {
            e.preventDefault();
            setEditing(false);
          }
        }}
      />
    );
  }

  const shown = type === 'date' && text ? formatDate(text) : text;
  return (
    <div className="myc-prop-value" onClick={() => setEditing(true)} role="button" tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && setEditing(true)}>
      {shown ? (
        <span className={type === 'url' ? 'myc-prop-url' : 'myc-prop-text'}>{shown}</span>
      ) : (
        <span className="myc-prop-empty">Empty</span>
      )}
      {type === 'url' && text && (
        <button
          className="myc-prop-open"
          title="Open link"
          onClick={(e) => {
            e.stopPropagation();
            void openUrl(text).catch((err) => console.error('Open URL failed:', err));
          }}
        >
          <ExternalLink size={12} />
        </button>
      )}
    </div>
  );
}

function ChoiceValue({
  name,
  multi,
  value,
  onChange,
}: {
  name: string;
  multi: boolean;
  value: PropValue;
  onChange: (next: PropValue) => void;
}) {
  const anchorRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [paletteFor, setPaletteFor] = useState<string | null>(null);
  const pos = useAnchorPos(anchorRef, open);
  useClickOutside([anchorRef, popRef], open, () => {
    setOpen(false);
    setQuery('');
    setPaletteFor(null);
  });

  const def = usePropertyDef(name);
  const addOptions = usePropertiesStore((s) => s.addOptions);
  const setOptionColor = usePropertiesStore((s) => s.setOptionColor);

  const selected: string[] = Array.isArray(value)
    ? value
    : value === null || value === ''
      ? []
      : [String(value)];
  // Options = everything this property has offered before, plus whatever
  // this note already holds (frontmatter written elsewhere).
  const options = [...new Set([...(def.options ?? []), ...selected])];
  const q = query.trim();
  const filtered = options.filter((o) => o.toLowerCase().includes(q.toLowerCase()));
  const canCreate = q !== '' && !options.some((o) => o.toLowerCase() === q.toLowerCase());

  const choose = (opt: string) => {
    addOptions(name, [opt]);
    if (multi) {
      const next = selected.includes(opt) ? selected.filter((s) => s !== opt) : [...selected, opt];
      onChange(next);
    } else {
      onChange(selected[0] === opt ? null : opt);
      setOpen(false);
    }
    setQuery('');
  };

  return (
    <>
      <div
        ref={anchorRef}
        className="myc-prop-value"
        role="button"
        tabIndex={0}
        onClick={() => setOpen(true)}
        onKeyDown={(e) => e.key === 'Enter' && setOpen(true)}
      >
        {selected.length === 0 ? (
          <span className="myc-prop-empty">Empty</span>
        ) : (
          <span className="myc-prop-chips">
            {selected.map((v) => (
              <span key={v} className="db-tag myc-prop-chip" style={tagStyle(v, def.colors)}>
                {v}
              </span>
            ))}
          </span>
        )}
      </div>
      {open &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            className="db-popover db-cell-popover myc-prop-popover"
            style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: Math.max(240, pos.minWidth), zIndex: 60 }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            {selected.length > 0 && (
              <div className="myc-prop-popover-selected">
                {selected.map((v) => (
                  <span key={v} className="db-tag myc-prop-chip" style={tagStyle(v, def.colors)}>
                    {v}
                    <button
                      className="myc-prop-chip-x"
                      title="Remove"
                      onClick={() => onChange(multi ? selected.filter((s) => s !== v) : null)}
                    >
                      <X size={10} />
                    </button>
                  </span>
                ))}
              </div>
            )}
            <input
              autoFocus
              className="db-popover-input"
              placeholder={options.length ? 'Select an option or create one' : 'Type to create an option'}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  e.preventDefault();
                  setOpen(false);
                }
                if (e.key === 'Enter') {
                  e.preventDefault();
                  if (canCreate) choose(q);
                  else if (filtered[0]) choose(filtered[0]);
                }
                if (e.key === 'Backspace' && query === '' && selected.length > 0) {
                  onChange(multi ? selected.slice(0, -1) : null);
                }
              }}
            />
            <div className="db-popover-list">
              {filtered.map((o) => (
                <div key={o} className={`db-popover-item db-popover-item-row ${selected.includes(o) ? 'is-active' : ''}`}>
                  <button className="db-popover-item-main" onClick={() => choose(o)}>
                    <span className="db-tag" style={tagStyle(o, def.colors)}>{o}</span>
                  </button>
                  <button
                    className={`db-icon-btn db-tag-color-toggle ${paletteFor === o ? 'is-active' : ''}`}
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
                        current={def.colors?.[o]}
                        onPick={(hue) => {
                          setOptionColor(name, o, hue);
                          setPaletteFor(null);
                        }}
                      />
                    </div>
                  )}
                </div>
              ))}
              {canCreate && (
                <button className="db-popover-item" onClick={() => choose(q)}>
                  Create <span className="db-tag" style={tagStyle(q, def.colors)}>{q}</span>
                </button>
              )}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
