import { RefObject, useEffect, useLayoutEffect, useState } from 'react';

export interface AnchorPos {
  top: number;
  left: number;
  minWidth: number;
}

/**
 * Tracks the bounding rect of an anchor element so a portaled popover can
 * follow it through scrolls and resizes. Returns null until the anchor is
 * mounted in the DOM.
 */
export function useAnchorPos(
  anchorRef: RefObject<HTMLElement | null>,
  active: boolean,
): AnchorPos | null {
  const [pos, setPos] = useState<AnchorPos | null>(null);

  useLayoutEffect(() => {
    if (!active) {
      setPos(null);
      return;
    }
    function update() {
      const el = anchorRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPos({ top: r.bottom + 2, left: r.left, minWidth: r.width });
    }
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [anchorRef, active]);

  return pos;
}

/**
 * Closes the popover when the user clicks outside both the anchor and the
 * popover. Skips if either ref is unmounted.
 */
export function useClickOutside(
  refs: RefObject<HTMLElement | null>[],
  active: boolean,
  onClose: () => void,
) {
  useEffect(() => {
    if (!active) return;
    function handler(e: MouseEvent) {
      const t = e.target as Node;
      for (const r of refs) {
        if (r.current && r.current.contains(t)) return;
      }
      onClose();
    }
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, onClose]);
}
