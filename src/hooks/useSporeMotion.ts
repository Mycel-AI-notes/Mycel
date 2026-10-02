import { useEffect, useSyncExternalStore } from 'react';
import { useUIStore } from '@/stores/ui';

const QUERY = '(prefers-reduced-motion: reduce)';

function subscribeReduced(cb: () => void) {
  const mq = window.matchMedia(QUERY);
  mq.addEventListener('change', cb);
  return () => mq.removeEventListener('change', cb);
}

function reducedSnapshot() {
  return window.matchMedia(QUERY).matches;
}

/**
 * Whether spore motion should play: the user's "Spore motion" setting,
 * overridden by the OS reduced-motion preference.
 */
export function useSporeMotion(): boolean {
  const enabled = useUIStore((s) => s.features.sporeMotion !== false);
  const reduced = useSyncExternalStore(subscribeReduced, reducedSnapshot, () => false);
  return enabled && !reduced;
}

/**
 * Mirrors the flag onto `<html class="myc-still">` so the CSS-only
 * flourishes (note rooting, row sprouting, folder growth) switch off too.
 * Mount once, near the root.
 */
export function useSporeMotionRootClass() {
  const on = useSporeMotion();
  useEffect(() => {
    document.documentElement.classList.toggle('myc-still', !on);
  }, [on]);
}
