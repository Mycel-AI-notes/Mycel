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
 * Whether cosmic motion should play: the user's "Cosmic motion" setting,
 * overridden by the OS reduced-motion preference.
 */
export function useCosmicMotion(): boolean {
  const enabled = useUIStore((s) => s.features.cosmic !== false);
  const reduced = useSyncExternalStore(subscribeReduced, reducedSnapshot, () => false);
  return enabled && !reduced;
}

/**
 * Mirrors the flag onto `<html class="cosmic-off">` so the CSS-only
 * flourishes (note materialise, row birth, folder unfold) switch off too.
 * Mount once, near the root.
 */
export function useCosmicRootClass() {
  const on = useCosmicMotion();
  useEffect(() => {
    document.documentElement.classList.toggle('cosmic-off', !on);
  }, [on]);
}
