import { useEffect, useRef, useState } from 'react';
import { Palette as PaletteIcon } from 'lucide-react';
import { clsx } from 'clsx';
import { useUIStore, PALETTES, type Palette } from '@/stores/ui';

export function PalettePicker() {
  const palette = useUIStore((s) => s.palette);
  const setPalette = useUIStore((s) => s.setPalette);
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const choose = (id: Palette) => {
    setPalette(id);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="p-1 rounded hover:bg-surface-hover hover:text-text-primary transition-colors"
        title="Color palette"
        aria-haspopup="menu"
        aria-expanded={open}
      >
        <PaletteIcon size={14} />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 bottom-full mb-1 z-50 min-w-[160px] rounded-md border border-border bg-surface-0 shadow-lg py-1"
        >
          {PALETTES.map((p) => (
            <button
              key={p.id}
              role="menuitemradio"
              aria-checked={palette === p.id}
              onClick={() => choose(p.id)}
              className={clsx(
                'flex items-center gap-2 w-full px-2.5 py-1.5 text-left text-xs hover:bg-surface-hover',
                palette === p.id ? 'text-accent' : 'text-text-primary',
              )}
            >
              <span
                aria-hidden
                className="inline-block w-3 h-3 rounded-full border border-border-strong"
                style={{ background: p.swatch }}
              />
              <span className="flex-1">{p.label}</span>
              {palette === p.id && (
                <span aria-hidden className="text-[10px] text-accent">●</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
