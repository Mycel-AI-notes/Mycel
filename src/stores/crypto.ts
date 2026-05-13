import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { CryptoStatus, ReencryptReport } from '@/types';
import { useVaultStore } from './vault';

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
    const recipient = await run(set, () =>
      invoke<string>('crypto_setup', { args: { passphrase } }),
    );
    await get().refresh();
    return recipient;
  },

  unlock: async (passphrase) => {
    // Inlined (not using `run`) so `busy` stays `true` across both the
    // unlock invoke AND the follow-up status refresh, and the final
    // `busy: false` is batched with `panelOpen: false`. Otherwise the
    // button flashes back to its idle "Unlock" label between the two
    // awaits, which looks like the unlock failed.
    set({ busy: true, error: null });
    try {
      await invoke<void>('crypto_unlock', { args: { passphrase } });
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
      set({ panelOpen: false, busy: false });
    } catch (e) {
      set({ error: typeof e === 'string' ? e : (e as Error).message, busy: false });
      throw e;
    }
  },

  setPassphrase: async (passphrase) => {
    await run(set, () =>
      invoke<void>('crypto_set_passphrase', { args: { passphrase } }),
    );
    await get().refresh();
  },

  lock: async () => {
    await run(set, () => invoke<void>('crypto_lock'));
    // Drop every plaintext body the JS side cached and close every open
    // `.md.age` tab. Otherwise the wrap secret is gone from Rust but the
    // already-decrypted markdown lingers in memory and tabs keep working.
    useVaultStore.getState().purgeEncryptedFromMemory();
    await get().refresh();
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
