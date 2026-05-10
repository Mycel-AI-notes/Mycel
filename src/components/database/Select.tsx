import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown } from 'lucide-react';

export interface SelectOption<T extends string> {
  value: T;
  label: ReactNode;
}

interface Props<T extends string> {
  value: T;
  options: SelectOption<T>[];
  onChange: (next: T) => void;
  placeholder?: string;
  width?: number | string;
  className?: string;
  disabled?: boolean;
}

interface AnchorPos {
  top: number;
  left: number;
  width: number;
}

export function Select<T extends string>({
  value,
  options,
  onChange,
  placeholder,
  width,
  className,
  disabled,
}: Props<T>) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<AnchorPos | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  // Re-position the floating list every time it opens, every frame the
  // window scrolls or resizes. Using fixed positioning + portal escapes
  // ancestor `overflow:hidden` / `overflow:auto` clipping, which was the
  // root cause of the dropdown getting cut off inside modals and popovers.
  useLayoutEffect(() => {
    if (!open || !triggerRef.current) {
      setPos(null);
      return;
    }
    const update = () => {
      const r = triggerRef.current!.getBoundingClientRect();
      setPos({ top: r.bottom + 4, left: r.left, width: r.width });
    };
    update();
    window.addEventListener('resize', update);
    // capture-phase scroll listener catches scrolls in any nested scroll
    // container, not just the viewport.
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (listRef.current?.contains(t)) return;
      setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div
      className={`db-select ${className ?? ''}`}
      style={{ width }}
      data-disabled={disabled || undefined}
    >
      <button
        ref={triggerRef}
        type="button"
        className={`db-select-trigger ${open ? 'is-open' : ''}`}
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
      >
        <span className="db-select-value">
          {selected ? (
            selected.label
          ) : (
            <span className="db-select-placeholder">{placeholder ?? '—'}</span>
          )}
        </span>
        <ChevronDown
          size={12}
          className={`db-select-chevron ${open ? 'is-open' : ''}`}
        />
      </button>
      {open &&
        pos &&
        createPortal(
          <div
            ref={listRef}
            className="db-select-list"
            role="listbox"
            // Stop the mousedown from bubbling to document-level listeners.
            // Without this, parent popovers (Sort / Settings / etc.) close
            // themselves on every option click because their click-outside
            // handler sees a click in body, not inside their own ref.
            onMouseDown={(e) => e.stopPropagation()}
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              minWidth: pos.width,
              zIndex: 1000,
            }}
          >
            {options.map((o) => (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={o.value === value}
                className={`db-select-option ${o.value === value ? 'is-active' : ''}`}
                onClick={() => {
                  onChange(o.value);
                  setOpen(false);
                }}
              >
                {o.label}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </div>
  );
}
