import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { CryptoStatus } from '@/types';

interface CryptoState {
  status: CryptoStatus | null;
  /** Last error from setup/unlock/encrypt/decrypt. UI surfaces this. */
  error: string | null;
  /** True while a backend crypto call is in flight. */
  busy: boolean;

  refresh: () => Promise<void>;
  setup: () => Promise<string>;
  unlock: () => Promise<void>;
  lock: () => Promise<void>;
  reset: () => Promise<void>;
  listRecipients: () => Promise<string[]>;
  addRecipient: (recipient: string) => Promise<void>;
  removeRecipient: (recipient: string) => Promise<void>;
  encryptNote: (path: string) => Promise<string>;
  decryptNote: (path: string) => Promise<string>;
  clearError: () => void;
  reset_for_new_vault: () => void;
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

  setup: async () => {
    const recipient = await run(set, () => invoke<string>('crypto_setup'));
    await get().refresh();
    return recipient;
  },

  unlock: async () => {
    await run(set, () => invoke<void>('crypto_unlock'));
    await get().refresh();
  },

  lock: async () => {
    await run(set, () => invoke<void>('crypto_lock'));
    await get().refresh();
  },

  reset: async () => {
    await run(set, () => invoke<void>('crypto_reset'));
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

  clearError: () => set({ error: null }),

  reset_for_new_vault: () => set({ status: null, error: null, busy: false }),
}));
