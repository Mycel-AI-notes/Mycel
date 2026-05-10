import { ReactNode, useEffect, useRef, useState } from 'react';
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
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const selected = options.find((o) => o.value === value);

  return (
    <div
      ref={ref}
      className={`db-select ${className ?? ''}`}
      style={{ width }}
      data-disabled={disabled || undefined}
    >
      <button
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
      {open && (
        <div className="db-select-list" role="listbox">
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
        </div>
      )}
    </div>
  );
}
