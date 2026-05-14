import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';

// Wire types mirror the Rust side in src-tauri/src/core/ai/insights/.
// `kind` and `actions[].type` come over as snake_case strings — keep them as
// raw strings so adding a new kind in Phase 2 doesn't require a frontend
// rebuild before the engine can produce it.

export type InsightKind =
  | 'missing_wikilink'
  | 'bridge_candidate'
  | 'resurfacing'
  | 'today_companion'
  | 'question_answered'
  | 'news_for_theme'
  | 'echo'
  | 'stranded_note'
  | 'emerging_theme'
  | 'problem_researched'
  | 'idea_state_of_art';

export type InsightAction =
  | { type: 'open_note'; note_path: string }
  | { type: 'open_side_by_side'; note_paths: string[] }
  | { type: 'insert_wikilink'; source: string; target: string }
  | { type: 'create_note_from_template'; template_id: string; suggested_path: string }
  | { type: 'open_external'; url: string }
  | { type: 'resolve_duplicate'; note_paths: string[] };

export interface ExternalRef {
  url: string;
  title: string;
  snippet?: string;
}

export interface Insight {
  id: string;
  kind: InsightKind;
  confidence: number;
  title: string;
  body: string;
  note_paths: string[];
  actions: InsightAction[];
  external_refs: ExternalRef[];
  generated_at: number;
}

export interface ScheduleSettings {
  time: string;
  catch_up: boolean;
}

export interface LimitSettings {
  max_per_day: number;
  max_per_kind: number;
  default_cooldown_days: number;
}

export interface InsightsSettings {
  enabled: boolean;
  schedule: ScheduleSettings;
  limits: LimitSettings;
  detectors: Record<string, boolean>;
  /// Minimum semantic similarity (0-100%) for the similar-notes detector.
  similar_notes_min_similarity: number;
}

export interface InsightsStatus {
  settings: InsightsSettings;
  pending_count: number;
  last_run_at: number | null;
}

export interface RunSummary {
  started_at: number;
  finished_at: number;
  detectors_run: number;
  insights_generated: number;
  errors: string[];
}

export interface DetectorTelemetry {
  detector_name: string;
  shown: number;
  acted: number;
  dismissed: number;
}

export interface TelemetryReport {
  days: number;
  rows: DetectorTelemetry[];
}

interface InsightsState {
  status: InsightsStatus | null;
  insights: Insight[];
  loading: boolean;
  running: boolean;
  lastRun: RunSummary | null;
  lastError: string | null;

  loadStatus: () => Promise<void>;
  loadList: () => Promise<void>;
  runNow: () => Promise<void>;
  dismiss: (id: string) => Promise<void>;
  act: (id: string) => Promise<void>;
  updateSettings: (s: InsightsSettings) => Promise<void>;
  getReport: (days: number) => Promise<TelemetryReport>;
  reset: () => void;
}

export const useInsightsStore = create<InsightsState>((set, get) => ({
  status: null,
  insights: [],
  loading: false,
  running: false,
  lastRun: null,
  lastError: null,

  reset: () =>
    set({
      status: null,
      insights: [],
      loading: false,
      running: false,
      lastRun: null,
      lastError: null,
    }),

  loadStatus: async () => {
    try {
      const status = await invoke<InsightsStatus>('insights_settings_get');
      set({ status, lastError: null });
    } catch (e) {
      // Same shape as the AI store: no vault → null status → UI hides.
      set({ lastError: String(e), status: null });
    }
  },

  loadList: async () => {
    set({ loading: true });
    try {
      const insights = await invoke<Insight[]>('insights_list', {
        status: 'pending',
        limit: 100,
      });
      set({ insights, loading: false, lastError: null });
    } catch (e) {
      set({ loading: false, lastError: String(e) });
    }
  },

  runNow: async () => {
    set({ running: true });
    try {
      const summary = await invoke<RunSummary>('insights_run_now');
      set({ lastRun: summary, running: false, lastError: null });
      await get().loadList();
      await get().loadStatus();
    } catch (e) {
      set({ running: false, lastError: String(e) });
    }
  },

  dismiss: async (id: string) => {
    // Optimistic remove so the card animates out instantly; if the Rust call
    // fails, we re-fetch to restore truth.
    const previous = get().insights;
    set({ insights: previous.filter((i) => i.id !== id) });
    try {
      await invoke('insights_dismiss', { insightId: id });
      await get().loadStatus();
    } catch (e) {
      set({ lastError: String(e), insights: previous });
    }
  },

  act: async (id: string) => {
    const previous = get().insights;
    set({ insights: previous.filter((i) => i.id !== id) });
    try {
      await invoke('insights_act', { insightId: id });
      await get().loadStatus();
    } catch (e) {
      set({ lastError: String(e), insights: previous });
    }
  },

  updateSettings: async (s: InsightsSettings) => {
    try {
      const status = await invoke<InsightsStatus>('insights_settings_set', {
        settings: s,
      });
      set({ status, lastError: null });
    } catch (e) {
      set({ lastError: String(e) });
    }
  },

  getReport: async (days: number) => {
    return invoke<TelemetryReport>('insights_telemetry_report', { days });
  },
}));
