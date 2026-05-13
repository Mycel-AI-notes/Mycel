import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { CryptoStatus, ReencryptReport } from '@/types';
import { useVaultStore } from './vault';

/** Stages the unlock dialog can be in. The Rust side emits the first
 *  four via `crypto:unlock-stage`; the JS layer adds `"refresh"` for the
 *  follow-up `crypto_status` call. `null` means "not unlocking". */
export type UnlockStage =
  | 'keyring'
  | 'outer'
  | 'passphrase'
  | 'identity'
  | 'refresh'
  | null;

/** Stages the setup dialog can be in. Rust emits `keypair`,
 *  `wrap-passphrase` (only when a passphrase was chosen), `wrap-keyring`,
 *  and `store` via `crypto:setup-stage`; JS appends `refresh`. */
export type SetupStage =
  | 'keypair'
  | 'wrap-passphrase'
  | 'wrap-keyring'
  | 'store'
  | 'refresh'
  | null;

/** Stages the lock flow can be in. Lock itself is fast (one in-memory
 *  zeroize), so we drive these entirely from JS rather than emitting
 *  events from Rust. A small minimum dwell per stage in `lock()` keeps
 *  the animation visible — otherwise it would flash by in one frame. */
export type LockStage = 'wipe' | 'tabs' | 'refresh' | null;

/** Resolve `fn()` no sooner than `min` ms later. Used by the lock flow
 *  so the UI animation has time to render each stage even when the
 *  underlying work is sub-millisecond. */
async function withMinDelay<T>(min: number, fn: () => Promise<T> | T): Promise<T> {
  const [v] = await Promise.all([
    Promise.resolve().then(fn),
    new Promise((r) => setTimeout(r, min)),
  ]);
  return v as T;
}

/** Auto-lock kicks in after this many ms of user inactivity while the
 *  vault is unlocked. 5 minutes is a familiar default (matches macOS
 *  Keychain's idle-lock window). */
export const AUTO_LOCK_IDLE_MS = 5 * 60 * 1000;

/**
 * Module-level deferred promise used by `requireUnlock`. Callers that
 * need an unlocked vault (e.g. `openNote` on a `.md.age`) call
 * `requireUnlock()`, which opens the crypto panel in unlock mode and
 * resolves the promise once the user successfully unlocks — or rejects
 * if they close the panel.
 *
 * Kept outside the store because Zustand's state should stay JSON-able
 * and we don't want to serialize React-shaped data.
 */
let pendingUnlock: { resolve: () => void; reject: (e: Error) => void } | null = null;

interface CryptoState {
  status: CryptoStatus | null;
  /** Last error from setup/unlock/encrypt/decrypt. UI surfaces this. */
  error: string | null;
  /** True while a backend crypto call is in flight. */
  busy: boolean;
  /** Current step the unlock flow is on. Driven by `crypto:unlock-stage`
   *  events from Rust plus the JS-side `"refresh"` step. `null` outside
   *  of an active unlock. */
  unlockStage: UnlockStage;
  /** Same idea for setup. Driven by `crypto:setup-stage` events. */
  setupStage: SetupStage;
  /** Same idea for lock. Driven purely from JS — see `lock()`. */
  lockStage: LockStage;
  /** Epoch-ms of the last user input. Set by `useAutoLock`. */
  lastActivityAt: number;
  /** Whether the crypto panel (the modal opened by the toolbar shield)
   *  is shown. Centralised in the store so other code paths (clicking a
   *  locked `.md.age` in the file tree) can open it too. */
  panelOpen: boolean;

  refresh: () => Promise<void>;
  setup: (passphrase: string) => Promise<string>;
  unlock: (passphrase: string) => Promise<void>;
  /** Upgrade a passphrase-less vault, or rotate the passphrase. The
   *  X25519 secret is preserved — existing `.md.age` notes keep working. */
  setPassphrase: (passphrase: string) => Promise<void>;
  lock: () => Promise<void>;
  reset: () => Promise<void>;
  listRecipients: () => Promise<string[]>;
  addRecipient: (recipient: string) => Promise<void>;
  removeRecipient: (recipient: string) => Promise<void>;
  encryptNote: (path: string) => Promise<string>;
  decryptNote: (path: string) => Promise<string>;
  /** Walk the vault and rewrap every `.md.age` to the current
   *  recipients.txt set. Used after a new device joins. */
  reencryptAll: () => Promise<ReencryptReport>;
  clearError: () => void;
  reset_for_new_vault: () => void;
  /** Called by `useAutoLock` on user input. */
  markActivity: () => void;
  openPanel: () => void;
  closePanel: () => void;
  /** Used by callers that need an unlocked vault to proceed. Opens the
   *  crypto panel (which renders the unlock prompt) and returns a
   *  promise that resolves on successful unlock or rejects if the
   *  user closes the panel without unlocking. */
  requireUnlock: () => Promise<void>;
}

async function run<T>(set: (p: Partial<CryptoState>) => void, fn: () => Promise<T>): Promise<T> {
  set({ busy: true, error: null });
  try {
    const v = await fn();
    return v;
  } catch (e) {
    set({ error: typeof e === 'string' ? e : (e as Error).message });
    throw e;
  } finally {
    set({ busy: false });
  }
}

export const useCryptoStore = create<CryptoState>((set, get) => ({
  status: null,
  error: null,
  busy: false,
  unlockStage: null,
  setupStage: null,
  lockStage: null,
  lastActivityAt: Date.now(),
  panelOpen: false,

  refresh: async () => {
    try {
      const status = await invoke<CryptoStatus>('crypto_status');
      set({ status });
    } catch (e) {
      // Refresh is opportunistic — when no vault is open the command errors,
      // which is expected. Don't surface it.
      set({ status: null });
      void e;
    }
  },

  setup: async (passphrase) => {
    // Mirrors `unlock`: stays `busy` across both Tauri round-trips,
    // subscribes to per-stage events from Rust so the dialog can show a
    // real checklist, batches the final `busy: false` so the form
    // doesn't flash back between the invoke and the refresh.
    set({ busy: true, error: null, setupStage: null });
    let unlisten: UnlistenFn | undefined;
    try {
      unlisten = await listen<string>('crypto:setup-stage', (e) => {
        set({ setupStage: e.payload as SetupStage });
      });
      const recipient = await invoke<string>('crypto_setup', { args: { passphrase } });
      set({ setupStage: 'refresh' });
      await get().refresh();
      set({ busy: false, setupStage: null });
      return recipient;
    } catch (e) {
      set({
        error: typeof e === 'string' ? e : (e as Error).message,
        busy: false,
        setupStage: null,
      });
      throw e;
    } finally {
      unlisten?.();
    }
  },

  unlock: async (passphrase) => {
    // Inlined (not using `run`) so `busy` stays `true` across both the
    // unlock invoke AND the follow-up status refresh, and the final
    // `busy: false` is batched with `panelOpen: false`. Otherwise the
    // button flashes back to its idle "Unlock" label between the two
    // awaits, which looks like the unlock failed.
    //
    // We also subscribe to the `crypto:unlock-stage` event for the
    // duration of the unlock so the dialog can show real "doing X…"
    // labels instead of a generic spinner. The listener is registered
    // BEFORE invoke() to avoid missing the first stage event.
    set({ busy: true, error: null, unlockStage: null });
    let unlisten: UnlistenFn | undefined;
    try {
      unlisten = await listen<string>('crypto:unlock-stage', (e) => {
        set({ unlockStage: e.payload as UnlockStage });
      });
      await invoke<void>('crypto_unlock', { args: { passphrase } });
      // After the Rust unlock returns, we still have one more (fast)
      // Tauri round-trip to refresh status. Surface it so the user
      // doesn't wonder why the dialog hasn't closed yet.
      set({ unlockStage: 'refresh' });
      await get().refresh();
      // If somebody was waiting for an unlock (a click on a locked
      // `.md.age` note, for instance), resolve their promise.
      if (pendingUnlock) {
        pendingUnlock.resolve();
        pendingUnlock = null;
      }
      // Close panel and clear busy in a single update so the unlock
      // dialog vanishes without a flash of ManageView or a re-armed
      // Unlock button in between.
      set({ panelOpen: false, busy: false, unlockStage: null });
    } catch (e) {
      set({
        error: typeof e === 'string' ? e : (e as Error).message,
        busy: false,
        unlockStage: null,
      });
      throw e;
    } finally {
      unlisten?.();
    }
  },

  setPassphrase: async (passphrase) => {
    await run(set, () =>
      invoke<void>('crypto_set_passphrase', { args: { passphrase } }),
    );
    await get().refresh();
  },

  lock: async () => {
    // Walk through the three real lock steps with a minimum dwell on
    // each so the user sees the animation. The underlying work is fast
    // (memory zeroize + close cached tabs + status refresh), so without
    // the dwell each stage would render for <1 frame.
    set({ busy: true, error: null, lockStage: 'wipe' });
    try {
      await withMinDelay(180, () => invoke<void>('crypto_lock'));
      set({ lockStage: 'tabs' });
      // Drop every plaintext body the JS side cached and close every
      // open `.md.age` tab. Otherwise the wrap secret is gone from
      // Rust but the already-decrypted markdown lingers in memory and
      // tabs keep working.
      await withMinDelay(180, () => useVaultStore.getState().purgeEncryptedFromMemory());
      set({ lockStage: 'refresh' });
      await withMinDelay(180, () => get().refresh());
      set({ busy: false, lockStage: null });
    } catch (e) {
      set({
        error: typeof e === 'string' ? e : (e as Error).message,
        busy: false,
        lockStage: null,
      });
      throw e;
    }
  },

  reset: async () => {
    await run(set, () => invoke<void>('crypto_reset'));
    useVaultStore.getState().purgeEncryptedFromMemory();
    await get().refresh();
  },

  listRecipients: async () => invoke<string[]>('crypto_list_recipients'),

  addRecipient: async (recipient) => {
    await run(set, () => invoke<void>('crypto_add_recipient', { args: { recipient } }));
    await get().refresh();
  },

  removeRecipient: async (recipient) => {
    await run(set, () => invoke<void>('crypto_remove_recipient', { args: { recipient } }));
    await get().refresh();
  },

  encryptNote: async (path) => {
    const r = await run(set, () => invoke<{ path: string }>('note_encrypt', { path }));
    return r.path;
  },

  decryptNote: async (path) => {
    const r = await run(set, () => invoke<{ path: string }>('note_decrypt', { path }));
    return r.path;
  },

  reencryptAll: async () => {
    return run(set, () => invoke<ReencryptReport>('crypto_reencrypt_all'));
  },

  clearError: () => set({ error: null }),

  reset_for_new_vault: () =>
    set({ status: null, error: null, busy: false, lastActivityAt: Date.now() }),

  markActivity: () => set({ lastActivityAt: Date.now() }),

  openPanel: () => set({ panelOpen: true }),

  closePanel: () => {
    set({ panelOpen: false });
    // Any caller that was awaiting an unlock has effectively been
    // cancelled by the user closing the panel.
    if (pendingUnlock) {
      pendingUnlock.reject(new Error('Unlock cancelled'));
      pendingUnlock = null;
    }
  },

  requireUnlock: () => {
    if (get().status?.unlocked) return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      // If two callers race, the older one is superseded — it would be
      // weird to "succeed" both because the second wanted a fresh
      // gesture from the user anyway.
      if (pendingUnlock) pendingUnlock.reject(new Error('Superseded'));
      pendingUnlock = { resolve, reject };
      set({ panelOpen: true });
    });
  },
}));
