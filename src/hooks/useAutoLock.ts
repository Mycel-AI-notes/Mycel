import { useEffect } from 'react';
import { AUTO_LOCK_IDLE_MS, useCryptoStore } from '@/stores/crypto';

/**
 * Auto-lock the vault after a window of user inactivity.
 *
 * Activity = any keydown / pointerdown / pointermove (throttled). On
 * activity we bump `lastActivityAt`; a single shared interval checks
 * "are we unlocked, and has it been >= AUTO_LOCK_IDLE_MS since the
 * last input?". If yes, the in-memory X25519 secret is wiped and any
 * cached `.md.age` bodies are purged from the vault store.
 *
 * Mount this hook once at the app root. Without it, an unlocked vault
 * would stay open indefinitely — fine for a quick session, dangerous
 * if you forget to lock manually.
 */
export function useAutoLock() {
  useEffect(() => {
    // Throttle activity writes — pointermove fires hundreds of times per
    // second. A 1s resolution is plenty for a 5-minute timer.
    let lastBump = 0;
    const bump = () => {
      const now = Date.now();
      if (now - lastBump < 1000) return;
      lastBump = now;
      useCryptoStore.getState().markActivity();
    };

    window.addEventListener('keydown', bump);
    window.addEventListener('pointerdown', bump);
    window.addEventListener('pointermove', bump);
    // Treat the window losing focus as "user walked away" — bump activity
    // on the way out so the timer starts counting from this moment.
    const onBlur = () => useCryptoStore.getState().markActivity();
    window.addEventListener('blur', onBlur);

    const tick = window.setInterval(() => {
      const s = useCryptoStore.getState();
      if (!s.status?.unlocked) return;
      if (Date.now() - s.lastActivityAt >= AUTO_LOCK_IDLE_MS) {
        void s.lock();
      }
    }, 15_000);

    return () => {
      window.removeEventListener('keydown', bump);
      window.removeEventListener('pointerdown', bump);
      window.removeEventListener('pointermove', bump);
      window.removeEventListener('blur', onBlur);
      window.clearInterval(tick);
    };
  }, []);
}
