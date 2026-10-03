import { useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  AlignLeft,
  Calendar,
  CircleChevronDown,
  Code,
  Hash,
  Link2,
  List,
  Plus,
  SmilePlus,
  SquareCheck,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useAnchorPos, useClickOutside } from '@/components/database/floating';
import {
  PROP_TYPES,
  PROP_TYPE_LABEL,
  coerceValue,
  deleteProp,
  emptyValue,
  inferType,
  readPageMeta,
  renameProp,
  setIcon,
  setProp,
  type FrontmatterMutation,
  type PageProperty,
  type PropType,
} from '@/lib/page-meta';
import { usePropertiesStore } from '@/stores/properties';
import { PageIcon } from './PageIcon';
import { IconPicker } from './IconPicker';
import { PropertyValue } from './PropertyValue';
import { ICON_COLORS, PAGE_ICONS } from './page-icons';

const TYPE_ICON: Record<PropType, LucideIcon> = {
  text: AlignLeft,
  number: Hash,
  checkbox: SquareCheck,
  date: Calendar,
  select: CircleChevronDown,
  'multi-select': List,
  url: Link2,
};

interface Props {
  /** Frontmatter YAML (between the fences), or null when the note has none. */
  yaml: string | null;
  apply: (mutation: FrontmatterMutation) => void;
  onEditSource: () => void;
}

/**
 * The page header: icon above, properties below, both read from and written
 * to the note's frontmatter. Rendered by the CodeMirror widget in
 * `lib/codemirror/page-header-widget.ts` in place of the raw YAML.
 */
export function PageHeader({ yaml, apply, onEditSource }: Props) {
  const meta = readPageMeta(yaml);
  const defs = usePropertiesStore((s) => s.defs);
  const iconRef = useRef<HTMLButtonElement>(null);
  const addIconRef = useRef<HTMLButtonElement>(null);
  const [pickerFrom, setPickerFrom] = useState<'icon' | 'add' | null>(null);
  const [adding, setAdding] = useState(false);

  if (meta.invalid) {
    return (
      <div className="myc-page-header is-invalid">
        <span>The frontmatter isn't valid YAML, so properties can't be shown.</span>
        <button className="myc-page-header-btn" onClick={onEditSource}>
          <Code size={13} /> Edit source
        </button>
      </div>
    );
  }

  const typeOf = (p: PageProperty): PropType =>
    defs[p.key.toLowerCase()]?.type ?? inferType(p.key, p.value);

  const pickIcon = (icon: string, color: string | null) => {
    apply(setIcon(icon, PAGE_ICONS[icon] ? color : null));
    setPickerFrom(null);
  };

  const empty = !meta.icon && meta.properties.length === 0;

  return (
    <div className={`myc-page-header ${empty ? 'is-empty' : ''}`}>
      <div className="myc-page-header-tools">
        {!meta.icon && (
          <button
            ref={addIconRef}
            className="myc-page-header-btn"
            onClick={() => setPickerFrom('add')}
          >
            <SmilePlus size={14} /> Add icon
          </button>
        )}
        {meta.properties.length === 0 && (
          <button className="myc-page-header-btn" onClick={() => setAdding(true)}>
            <Plus size={14} /> Add property
          </button>
        )}
        {!empty && (
          <button className="myc-page-header-btn" onClick={onEditSource} title="Edit the frontmatter as YAML">
            <Code size={13} /> YAML
          </button>
        )}
      </div>

      {meta.icon && (
        <button
          ref={iconRef}
          className="myc-page-header-icon"
          title="Change icon"
          onClick={() => setPickerFrom('icon')}
        >
          <PageIcon icon={meta.icon} color={meta.iconColor} size={34} tile />
        </button>
      )}

      {pickerFrom && (
        <IconPicker
          anchor={pickerFrom === 'icon' ? iconRef : addIconRef}
          icon={meta.icon}
          color={meta.iconColor ?? (pickerFrom === 'add' ? ICON_COLORS[5].name : null)}
          onPick={pickIcon}
          onRemove={() => {
            apply(setIcon(null, null));
            setPickerFrom(null);
          }}
          onClose={() => setPickerFrom(null)}
        />
      )}

      {(meta.properties.length > 0 || adding) && (
        <div className="myc-props">
          {meta.properties.map((p) => (
            <PropertyRow
              key={p.key}
              prop={p}
              type={typeOf(p)}
              taken={meta.properties.map((x) => x.key)}
              apply={apply}
            />
          ))}
          <AddProperty
            open={adding}
            setOpen={setAdding}
            taken={meta.properties.map((x) => x.key)}
            onAdd={(key, type) => {
              usePropertiesStore.getState().setType(key, type);
              apply(setProp(key, emptyValue(type)));
            }}
          />
        </div>
      )}
    </div>
  );
}

function PropertyRow({
  prop,
  type,
  taken,
  apply,
}: {
  prop: PageProperty;
  type: PropType;
  taken: string[];
  apply: (m: FrontmatterMutation) => void;
}) {
  const nameRef = useRef<HTMLButtonElement>(null);
  const [menu, setMenu] = useState(false);
  const Icon = TYPE_ICON[type];
  const value = coerceValue(prop.value, type);

  return (
    <div className="myc-prop-row">
      <button ref={nameRef} className="myc-prop-name" onClick={() => setMenu(true)} title={prop.key}>
        <Icon size={15} strokeWidth={1.75} />
        <span>{prop.key}</span>
      </button>
      <PropertyValue
        name={prop.key}
        type={type}
        value={value}
        onChange={(next) => apply(setProp(prop.key, next))}
      />
      {menu && (
        <PropertyMenu
          anchor={nameRef}
          name={prop.key}
          type={type}
          taken={taken}
          onClose={() => setMenu(false)}
          onRename={(to) => {
            usePropertiesStore.getState().renameDef(prop.key, to);
            apply(renameProp(prop.key, to));
          }}
          onType={(t) => {
            usePropertiesStore.getState().setType(prop.key, t);
            if (t === 'select' || t === 'multi-select') {
              const v = coerceValue(prop.value, t);
              const opts = Array.isArray(v) ? v : v === null ? [] : [String(v)];
              usePropertiesStore.getState().addOptions(prop.key, opts);
            }
            apply(setProp(prop.key, coerceValue(prop.value, t)));
          }}
          onDelete={() => {
            setMenu(false);
            apply(deleteProp(prop.key));
          }}
        />
      )}
    </div>
  );
}

function TypeList({ current, onPick }: { current?: PropType; onPick: (t: PropType) => void }) {
  return (
    <div className="db-popover-list">
      {PROP_TYPES.map((t) => {
        const Icon = TYPE_ICON[t];
        return (
          <button
            key={t}
            className={`db-popover-item ${current === t ? 'is-active' : ''}`}
            onClick={() => onPick(t)}
          >
            <Icon size={14} strokeWidth={1.75} className="myc-prop-type-icon" />
            {PROP_TYPE_LABEL[t]}
          </button>
        );
      })}
    </div>
  );
}

function usePopover(anchor: React.RefObject<HTMLElement | null>, onClose: () => void) {
  const popRef = useRef<HTMLDivElement>(null);
  const pos = useAnchorPos(anchor, true);
  useClickOutside([anchor, popRef], true, onClose);
  return { popRef, pos };
}

function PropertyMenu({
  anchor,
  name,
  type,
  taken,
  onClose,
  onRename,
  onType,
  onDelete,
}: {
  anchor: React.RefObject<HTMLElement | null>;
  name: string;
  type: PropType;
  taken: string[];
  onClose: () => void;
  onRename: (to: string) => void;
  onType: (t: PropType) => void;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState(name);
  const commitRename = () => {
    const to = draft.trim();
    if (to && to !== name && !taken.includes(to)) onRename(to);
  };
  const close = () => {
    commitRename();
    onClose();
  };
  const { popRef, pos } = usePopover(anchor, close);
  if (!pos) return null;
  const clash = draft.trim() !== name && taken.includes(draft.trim());

  return createPortal(
    <div
      ref={popRef}
      className="db-popover myc-prop-popover"
      style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: 220, zIndex: 60 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <input
        autoFocus
        className="db-popover-input"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'Escape') {
            e.preventDefault();
            if (e.key === 'Escape') setDraft(name);
            if (e.key === 'Enter') close();
            else onClose();
          }
        }}
      />
      {clash && <div className="myc-prop-hint">A property with this name already exists</div>}
      <div className="db-popover-section-label">Type</div>
      <TypeList
        current={type}
        onPick={(t) => {
          commitRename();
          if (t !== type) onType(t);
          onClose();
        }}
      />
      <div className="db-popover-divider" />
      <button className="db-popover-item db-popover-danger" onClick={onDelete}>
        <Trash2 size={14} /> Delete property
      </button>
    </div>,
    document.body,
  );
}

function AddProperty({
  open,
  setOpen,
  taken,
  onAdd,
}: {
  open: boolean;
  setOpen: (v: boolean) => void;
  taken: string[];
  onAdd: (key: string, type: PropType) => void;
}) {
  const btnRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <button ref={btnRef} className="myc-prop-add" onClick={() => setOpen(true)}>
        <Plus size={15} /> Add a property
      </button>
      {open && <AddPropertyPopover anchor={btnRef} taken={taken} onClose={() => setOpen(false)} onAdd={onAdd} />}
    </>
  );
}

function AddPropertyPopover({
  anchor,
  taken,
  onClose,
  onAdd,
}: {
  anchor: React.RefObject<HTMLElement | null>;
  taken: string[];
  onClose: () => void;
  onAdd: (key: string, type: PropType) => void;
}) {
  const [name, setName] = useState('');
  const { popRef, pos } = usePopover(anchor, onClose);
  const key = name.trim();
  const clash = taken.includes(key) || key === 'icon' || key === 'icon_color';
  const add = (t: PropType) => {
    if (!key || clash) return;
    onAdd(key, t);
    onClose();
  };
  if (!pos) return null;

  return createPortal(
    <div
      ref={popRef}
      className="db-popover myc-prop-popover"
      style={{ position: 'fixed', top: pos.top, left: pos.left, minWidth: 220, zIndex: 60 }}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <input
        autoFocus
        className="db-popover-input"
        placeholder="Property name"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.preventDefault();
            onClose();
          }
          if (e.key === 'Enter') {
            e.preventDefault();
            const known = usePropertiesStore.getState().defs[key.toLowerCase()]?.type;
            add(known ?? 'text');
          }
        }}
      />
      {clash && <div className="myc-prop-hint">This name is already taken</div>}
      <div className="db-popover-section-label">{key ? 'Choose a type' : 'Name it, then pick a type'}</div>
      <TypeList onPick={add} />
    </div>,
    document.body,
  );
}
