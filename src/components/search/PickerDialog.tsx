import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { clsx } from 'clsx';
import { Search } from 'lucide-react';
import { DisconnectedSpore } from '@/components/brand/Spore';
import { fuzzyFilter } from '@/lib/fuzzy';

export interface PickerItem {
  id: string;
  label: string;
  /** Secondary text under or beside the label (a path, a section). */
  detail?: string;
  /** Right-aligned hint, e.g. a formatted hotkey. */
  hint?: string;
  /** Extra text the filter matches against without showing it. */
  keywords?: string;
}

interface Props<T extends PickerItem> {
  items: T[];
  placeholder: string;
  emptyText: string;
  onPick: (item: T) => void;
  onClose: () => void;
  icon?: ReactNode;
}

/**
 * A keyboard-first fuzzy list in a modal: the shell shared by the command
 * palette and the template picker. Same look and keys as the quick switcher
 * (↑/↓ to move, Enter to pick, Esc to close), same matcher (`lib/fuzzy`).
 */
export function PickerDialog<T extends PickerItem>({
  items,
  placeholder,
  emptyText,
  onPick,
  onClose,
  icon,
}: Props<T>) {
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const results = useMemo(
    () => fuzzyFilter(items, query, (i) => `${i.label} ${i.detail ?? ''} ${i.keywords ?? ''}`),
    [items, query],
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setSelected(0);
  }, [query]);

  // Keep the highlighted row visible when arrowing past the fold.
  useEffect(() => {
    const row = listRef.current?.querySelector<HTMLElement>(`[data-index="${selected}"]`);
    row?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  const pick = (item: T | undefined) => {
    if (!item) return;
    onClose();
    onPick(item);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    // Keys typed here belong to the picker, not to the app-wide hotkeys.
    e.stopPropagation();
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, results.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(results[selected]);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] myc-scrim backdrop-blur-[3px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg myc-glass rounded-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          {icon ?? <Search size={16} className="text-text-muted shrink-0" />}
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            className="flex-1 bg-transparent text-text-primary placeholder:text-text-muted outline-none text-sm"
          />
          <kbd className="text-xs text-text-muted bg-surface-2 px-1.5 py-0.5 rounded">Esc</kbd>
        </div>

        <div ref={listRef} className="max-h-80 overflow-y-auto py-1">
          {results.length === 0 ? (
            <div className="flex flex-col items-center gap-2 py-8 text-text-muted">
              <DisconnectedSpore size={32} className="text-accent-muted" />
              <p className="text-sm">{emptyText}</p>
            </div>
          ) : (
            results.map((item, i) => (
              <button
                key={item.id}
                data-index={i}
                onMouseMove={() => setSelected(i)}
                onClick={() => pick(item)}
                className={clsx(
                  'w-full flex items-center gap-3 px-4 py-2 text-left',
                  i === selected
                    ? 'bg-accent/12 text-text-primary border-l-2 border-accent'
                    : 'text-text-secondary hover:bg-surface-hover border-l-2 border-transparent',
                )}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-sm truncate">{item.label}</div>
                  {item.detail && (
                    <div className="text-xs text-text-muted truncate">{item.detail}</div>
                  )}
                </div>
                {item.hint && (
                  <kbd className="text-[11px] text-text-muted bg-surface-1 border border-border px-1.5 py-0.5 rounded shrink-0">
                    {item.hint}
                  </kbd>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
