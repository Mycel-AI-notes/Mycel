import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

// Mirrors `commands::ai::settings::AiStatus` on the Rust side. Kept inline
// (rather than in src/types) because the AI surface is small and self-
// contained for MVP-1 — promote to a shared types module if more components
// start reading it.
export interface DailyUsage {
  date: string;
  tokens_in: number;
  tokens_out: number;
  cost_usd: number;
}

export interface AiStatus {
  enabled: boolean;
  has_key: boolean;
  daily_budget_usd: number;
  embedding_model: string;
  usage_today: DailyUsage;
}

interface AiState {
  status: AiStatus | null;
  loading: boolean;
  lastError: string | null;
  testResult: { ok: boolean; model: string } | null;

  load: () => Promise<void>;
  reset: () => void;
  setEnabled: (enabled: boolean) => Promise<void>;
  setBudget: (usd: number) => Promise<void>;
  setKey: (key: string) => Promise<void>;
  clearKey: () => Promise<void>;
  testKey: () => Promise<void>;
}

export const useAiStore = create<AiState>((set, get) => ({
  status: null,
  loading: false,
  lastError: null,
  testResult: null,

  reset: () =>
    set({ status: null, loading: false, lastError: null, testResult: null }),

  load: async () => {
    set({ loading: true, lastError: null });
    try {
      const status = await invoke<AiStatus>('ai_get_status');
      set({ status, loading: false });
    } catch (e) {
      // ai_get_status fails when no vault is open — that's expected, leave
      // status null and show nothing in the UI rather than an error toast.
      set({ loading: false, lastError: String(e) });
    }
  },

  setEnabled: async (enabled: boolean) => {
    try {
      const status = await invoke<AiStatus>('ai_update_config', {
        args: { enabled },
      });
      set({ status, lastError: null });
    } catch (e) {
      set({ lastError: String(e) });
    }
  },

  setBudget: async (usd: number) => {
    try {
      const status = await invoke<AiStatus>('ai_update_config', {
        args: { daily_budget_usd: usd },
      });
      set({ status, lastError: null });
    } catch (e) {
      set({ lastError: String(e) });
    }
  },

  setKey: async (key: string) => {
    set({ testResult: null });
    try {
      await invoke('ai_set_key', { args: { key } });
      // After storing, re-pull status so `has_key` flips to true in the UI.
      await get().load();
    } catch (e) {
      set({ lastError: String(e) });
      throw e;
    }
  },

  clearKey: async () => {
    try {
      await invoke('ai_clear_key');
      set({ testResult: null });
      await get().load();
    } catch (e) {
      set({ lastError: String(e) });
    }
  },

  testKey: async () => {
    set({ testResult: null, lastError: null });
    try {
      const result = await invoke<{ ok: boolean; model: string }>('ai_test_key');
      set({ testResult: result });
      // Test consumes a token — refresh the usage counter so the UI
      // reflects that the budget pipeline is live.
      await get().load();
    } catch (e) {
      set({ lastError: String(e), testResult: { ok: false, model: '' } });
    }
  },
}));
