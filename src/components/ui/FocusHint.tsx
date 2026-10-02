import { useEffect, useState } from 'react';
import { useUIStore } from '@/stores/ui';

/**
 * The only chrome left in focus mode: a small pill saying how to get out.
 * Shows for a moment on entry, then only when the pointer nears the top
 * edge — so it is findable without sitting in the way of the text.
 */
export function FocusHint({ hotkey }: { hotkey?: string | null }) {
  const toggle = useUIStore((s) => s.toggleFocusMode);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    let hide = setTimeout(() => setVisible(false), 2500);
    const onMove = (e: MouseEvent) => {
      if (e.clientY > 48) return;
      setVisible(true);
      clearTimeout(hide);
      hide = setTimeout(() => setVisible(false), 1800);
    };
    window.addEventListener('mousemove', onMove);
    return () => {
      clearTimeout(hide);
      window.removeEventListener('mousemove', onMove);
    };
  }, []);

  return (
    <button
      onClick={toggle}
      className={`fixed top-3 left-1/2 -translate-x-1/2 z-40 px-3 py-1 rounded-full border border-border bg-surface-0/80 backdrop-blur text-[11px] text-text-muted hover:text-text-primary transition-opacity duration-300 ${
        visible ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
    >
      Focus mode{hotkey ? ` · ${hotkey} to exit` : ' · click to exit'}
    </button>
  );
}
