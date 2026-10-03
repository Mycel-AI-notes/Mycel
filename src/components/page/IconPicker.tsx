import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useAnchorPos, useClickOutside } from '@/components/database/floating';
import { PageIcon } from './PageIcon';
import { ICON_COLORS, PAGE_EMOJI, PAGE_ICONS } from './page-icons';

interface Props {
  anchor: React.RefObject<HTMLElement | null>;
  icon: string | null;
  color: string | null;
  onPick: (icon: string, color: string | null) => void;
  onRemove: () => void;
  onClose: () => void;
}

type Tab = 'icons' | 'emoji';

export function IconPicker({ anchor, icon, color, onPick, onRemove, onClose }: Props) {
  const popRef = useRef<HTMLDivElement>(null);
  const pos = useAnchorPos(anchor, true);
  useClickOutside([anchor, popRef], true, onClose);
  const [tab, setTab] = useState<Tab>(icon && !PAGE_ICONS[icon] ? 'emoji' : 'icons');
  const [query, setQuery] = useState('');
  const [tint, setTint] = useState<string | null>(color);

  const q = query.trim().toLowerCase();
  const icons = Object.entries(PAGE_ICONS).filter(
    ([name, { keywords }]) => !q || name.includes(q) || keywords.includes(q),
  );

  const pickRandom = () => {
    if (tab === 'emoji') {
      onPick(PAGE_EMOJI[Math.floor(Math.random() * PAGE_EMOJI.length)], null);
    } else {
      const names = Object.keys(PAGE_ICONS);
      const c = ICON_COLORS[Math.floor(Math.random() * ICON_COLORS.length)].name;
      onPick(names[Math.floor(Math.random() * names.length)], c);
    }
  };

  if (!pos) return null;
  return createPortal(
    <div
      ref={popRef}
      className="db-popover myc-icon-picker"
      style={{ position: 'fixed', top: pos.top + 4, left: pos.left, zIndex: 60 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="myc-icon-picker-head">
        <div className="myc-icon-picker-tabs">
          {(['icons', 'emoji'] as Tab[]).map((t) => (
            <button
              key={t}
              className={tab === t ? 'is-active' : ''}
              onClick={() => setTab(t)}
            >
              {t === 'icons' ? 'Icons' : 'Emoji'}
            </button>
          ))}
        </div>
        <div className="myc-icon-picker-actions">
          <button onClick={pickRandom}>Random</button>
          {icon && <button onClick={onRemove}>Remove</button>}
        </div>
      </div>

      {tab === 'icons' && (
        <>
          <input
            autoFocus
            className="db-popover-input"
            placeholder="Search icons…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
              if (e.key === 'Enter' && icons[0]) onPick(icons[0][0], tint);
            }}
          />
          <div className="myc-icon-picker-colors">
            <button
              className={`myc-icon-swatch is-accent ${tint === null ? 'is-active' : ''}`}
              title="Accent"
              onClick={() => setTint(null)}
            />
            {ICON_COLORS.map((c) => (
              <button
                key={c.name}
                className={`myc-icon-swatch ${tint === c.name ? 'is-active' : ''}`}
                style={{ '--icon-hue': String(c.hue) } as React.CSSProperties}
                title={c.name}
                onClick={() => setTint(c.name)}
              />
            ))}
          </div>
          <div className="myc-icon-grid">
            {icons.map(([name]) => (
              <button
                key={name}
                title={name}
                className={icon === name ? 'is-active' : ''}
                onClick={() => onPick(name, tint)}
              >
                <PageIcon icon={name} color={tint} size={18} />
              </button>
            ))}
            {icons.length === 0 && <div className="myc-icon-grid-empty">No icons match</div>}
          </div>
        </>
      )}

      {tab === 'emoji' && (
        <div className="myc-icon-grid">
          {PAGE_EMOJI.map((e) => (
            <button
              key={e}
              className={icon === e ? 'is-active' : ''}
              onClick={() => onPick(e, null)}
            >
              <span className="myc-page-icon-emoji" style={{ fontSize: 18 }}>{e}</span>
            </button>
          ))}
        </div>
      )}
    </div>,
    document.body,
  );
}
