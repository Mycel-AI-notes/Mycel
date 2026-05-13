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
  /// Schedule an auto-index of a single note. Each call resets the
  /// per-path timer, so a flurry of saves (e.g. CodeMirror auto-save)
  /// collapses into one embedding call after the user stops typing.
  queueReindex: (relPath: string) => void;
  attachWatcher: () => Promise<void>;
  detachWatcher: () => void;
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

// ---- Auto-index on file change -----------------------------------------
//
// We mirror sync.ts's `scheduleAutoSync` pattern: a per-path setTimeout
// that resets on every file-changed event. After DEBOUNCE_MS of quiet for
// a given path, we fire `ai_index_note` for just that file. This keeps
// the indexer current without burning embeddings on every keystroke.

const DEBOUNCE_MS = 5_000;
const pendingTimers = new Map<string, ReturnType<typeof setTimeout>>();
let watcherUnlisten: UnlistenFn | null = null;

/// Returns true if the path is something the indexer cares about. We
/// short-circuit here so a torrent of `.db.json` or attachment changes
/// doesn't fill the timer map. Encrypted notes are skipped by the indexer
/// itself, but filtering here saves a Tauri round-trip.
function isIndexable(path: string): boolean {
  if (path.endsWith('.md.age')) return false;
  if (!path.endsWith('.md')) return false;
  // `.mycel/**` is our own metadata directory — never index it.
  if (path.startsWith('.mycel/') || path.includes('/.mycel/')) return false;
  return true;
}

async function runQueuedIndex(path: string) {
  pendingTimers.delete(path);
  const { status } = useAiStore.getState();
  // Re-check at fire time, not enqueue time: the user may have toggled
  // AI off during the debounce window, and we'd rather quietly skip than
  // hit the budget for a now-disabled flow.
  if (!status?.enabled || !status?.has_key) return;
  try {
    await invoke('ai_index_note', { args: { path } });
    // Refresh the counter so the Settings card stays in sync if open.
    try {
      const indexStatus = await invoke<IndexStatus>('ai_index_status');
      useAiStore.setState({ indexStatus });
    } catch {
      // ignored: vault might have closed
    }
  } catch (e) {
    // Single-file errors are silent — auto-index is a background nicety;
    // surfacing every transient OpenRouter blip as a toast would be
    // noisier than the value it adds. The error reaches the user via
    // the next manual "Reindex now" or the Settings card lastError.
    useAiStore.setState({ lastError: String(e) });
  }
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

  queueReindex: (relPath: string) => {
    if (!isIndexable(relPath)) return;
    const { status, indexing } = get();
    // Cheap upfront guard. Re-checked at fire time anyway, but skipping
    // the timer keeps the Map clean when AI is off.
    if (!status?.enabled || !status?.has_key) return;
    // While a bulk run is going, every file would race the bulk's own
    // pass. Skip — bulk will catch up to current state.
    if (indexing) return;

    const existing = pendingTimers.get(relPath);
    if (existing) clearTimeout(existing);
    pendingTimers.set(
      relPath,
      setTimeout(() => void runQueuedIndex(relPath), DEBOUNCE_MS),
    );
  },

  attachWatcher: async () => {
    if (watcherUnlisten) return;
    watcherUnlisten = await listen<{ path: string }>(
      'vault:file-changed',
      (e) => {
        const p = e.payload?.path;
        if (typeof p === 'string') {
          useAiStore.getState().queueReindex(p);
        }
      },
    );
  },

  detachWatcher: () => {
    if (watcherUnlisten) {
      watcherUnlisten();
      watcherUnlisten = null;
    }
    for (const t of pendingTimers.values()) clearTimeout(t);
    pendingTimers.clear();
  },
}));
