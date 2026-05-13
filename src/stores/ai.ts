import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';

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

export interface IndexStatus {
  notes_indexed: number;
  chunks_indexed: number;
}

export interface IndexProgress {
  done: number;
  total: number;
  note_path: string;
  error: string | null;
}

export interface BulkSummary {
  notes_ok: number;
  notes_failed: number;
  chunks_embedded: number;
  chunks_kept: number;
  chunks_removed: number;
  tokens_in: number;
  cost_usd: number;
}

interface AiState {
  status: AiStatus | null;
  indexStatus: IndexStatus | null;
  loading: boolean;
  lastError: string | null;
  testResult: { ok: boolean; model: string } | null;
  /// Set while a bulk reindex is in flight. The UI uses it to disable
  /// the Reindex button and render a progress bar.
  indexing: boolean;
  indexProgress: IndexProgress | null;
  lastBulkSummary: BulkSummary | null;

  load: () => Promise<void>;
  reset: () => void;
  setEnabled: (enabled: boolean) => Promise<void>;
  setBudget: (usd: number) => Promise<void>;
  setKey: (key: string) => Promise<void>;
  clearKey: () => Promise<void>;
  testKey: () => Promise<void>;
  reindexAll: () => Promise<void>;
}

// Tauri event listener for `ai-index-progress`. Attached lazily on the
// first bulk-reindex and then left in place — the listener costs nothing
// when no events are fired, so re-attaching on every run would just
// churn handles.
let progressUnlisten: UnlistenFn | null = null;
async function ensureProgressListener() {
  if (progressUnlisten) return;
  progressUnlisten = await listen<IndexProgress>('ai-index-progress', (e) => {
    useAiStore.setState({ indexProgress: e.payload });
  });
}

export const useAiStore = create<AiState>((set, get) => ({
  status: null,
  indexStatus: null,
  loading: false,
  lastError: null,
  testResult: null,
  indexing: false,
  indexProgress: null,
  lastBulkSummary: null,

  reset: () =>
    set({
      status: null,
      indexStatus: null,
      loading: false,
      lastError: null,
      testResult: null,
      indexing: false,
      indexProgress: null,
      lastBulkSummary: null,
    }),

  load: async () => {
    set({ loading: true, lastError: null });
    try {
      const status = await invoke<AiStatus>('ai_get_status');
      set({ status, loading: false });
      // Index status is cheap and harmless even when AI is off — the
      // counts are zero in that case. Skip it on failure though (e.g.
      // no vault) so a single command error doesn't blank the card.
      try {
        const indexStatus = await invoke<IndexStatus>('ai_index_status');
        set({ indexStatus });
      } catch {
        // expected when no vault is open
      }
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

  reindexAll: async () => {
    if (get().indexing) return;
    await ensureProgressListener();
    set({
      indexing: true,
      indexProgress: null,
      lastBulkSummary: null,
      lastError: null,
    });
    try {
      const summary = await invoke<BulkSummary>('ai_index_bulk');
      set({ lastBulkSummary: summary });
      await get().load();
    } catch (e) {
      set({ lastError: String(e) });
    } finally {
      set({ indexing: false, indexProgress: null });
    }
  },
}));
