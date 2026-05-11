import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { SyncConfig, SyncOutcome, SyncStatus } from '@/types';

interface SyncState {
  config: SyncConfig | null;
  status: SyncStatus | null;
  isSyncing: boolean;
  lastError: string | null;
  lastOutcome: SyncOutcome | null;

  loadForVault: () => Promise<void>;
  reset: () => void;
  setToken: (token: string) => Promise<void>;
  clearToken: () => Promise<void>;
  connect: (args: {
    remote: string;
    branch?: string;
    token: string;
    authorName?: string;
    authorEmail?: string;
  }) => Promise<void>;
  syncNow: () => Promise<SyncOutcome | null>;
  setAutoSync: (enabled: boolean) => Promise<void>;
  disconnect: () => Promise<void>;
  scheduleAutoSync: () => void;
}

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export const useSyncStore = create<SyncState>((set, get) => ({
  config: null,
  status: null,
  isSyncing: false,
  lastError: null,
  lastOutcome: null,

  reset: () => {
    if (debounceTimer) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }
    set({
      config: null,
      status: null,
      isSyncing: false,
      lastError: null,
      lastOutcome: null,
    });
  },

  loadForVault: async () => {
    try {
      const [config, status] = await Promise.all([
        invoke<SyncConfig | null>('sync_get_config'),
        invoke<SyncStatus>('sync_status'),
      ]);
      set({ config, status, lastError: null });
    } catch (e) {
      set({ lastError: String(e) });
    }
  },

  setToken: async (token: string) => {
    await invoke('sync_set_token', { token });
    const status = await invoke<SyncStatus>('sync_status');
    set({ status });
  },

  clearToken: async () => {
    await invoke('sync_clear_token');
    const status = await invoke<SyncStatus>('sync_status');
    set({ status });
  },

  connect: async ({ remote, branch, token, authorName, authorEmail }) => {
    set({ isSyncing: true, lastError: null });
    try {
      await invoke('sync_init', {
        args: {
          remote,
          branch: branch ?? 'main',
          author_name: authorName,
          author_email: authorEmail,
          token,
        },
      });
      await get().loadForVault();
    } catch (e) {
      set({ lastError: String(e) });
      throw e;
    } finally {
      set({ isSyncing: false });
    }
  },

  syncNow: async () => {
    const { isSyncing } = get();
    if (isSyncing) return null;
    set({ isSyncing: true, lastError: null });
    try {
      const outcome = await invoke<SyncOutcome>('sync_now');
      set({ lastOutcome: outcome });
      const status = await invoke<SyncStatus>('sync_status');
      set({ status });
      // Always re-read open tabs and the tree after a successful sync. We
      // used to gate this on `pulled`/`pulled_and_pushed`, but counting
      // pulled commits after a real merge collapses to zero and the sync
      // underreports as `pushed`, leaving the UI stale. The cost is one
      // tree read plus one file read per open tab — negligible compared
      // to the network round-trip we just made. The conflict path also
      // needs the reload so the user sees the freshly-written conflict
      // markers in the editor.
      const { useVaultStore } = await import('./vault');
      await useVaultStore.getState().reloadFromDisk();
      return outcome;
    } catch (e) {
      set({ lastError: String(e) });
      return null;
    } finally {
      set({ isSyncing: false });
    }
  },

  setAutoSync: async (enabled: boolean) => {
    const cfg = get().config;
    if (!cfg) return;
    const next: SyncConfig = { ...cfg, auto_sync: enabled };
    await invoke('sync_set_config', { config: next });
    set({ config: next });
  },

  disconnect: async () => {
    await invoke('sync_disable');
    await get().loadForVault();
  },

  scheduleAutoSync: () => {
    const { config, status } = get();
    if (!config?.auto_sync) return;
    if (!status?.configured || !status?.has_token) return;

    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void get().syncNow();
    }, config.debounce_ms ?? 30_000);
  },
}));
