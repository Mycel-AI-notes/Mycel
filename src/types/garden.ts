// Garden — types mirroring src-tauri/src/core/garden.rs

export interface InboxItem {
  id: string;
  text: string;
  captured_at: string;
  page?: string | null;
  source?: string | null;
  energy_hint?: string | null;
}

export interface ActionItem {
  id: string;
  action: string;
  context: string;
  project?: string | null;
  energy?: string | null;
  duration?: string | null;
  done: boolean;
  done_at?: string | null;
  created_at: string;
  page?: string | null;
}

export interface ProjectItem {
  id: string;
  title: string;
  outcome: string;
  /** "active" | "paused" | "done" */
  status: string;
  deadline?: string | null;
  area?: string | null;
  page?: string | null;
  created_at: string;
}

export interface WaitingItem {
  id: string;
  what: string;
  from: string;
  since: string;
  project?: string | null;
  done: boolean;
  done_at?: string | null;
  page?: string | null;
}

export interface SomedayItem {
  id: string;
  text: string;
  area?: string | null;
  page?: string | null;
  created_at: string;
}

export interface GardenConfig {
  contexts: string[];
  areas: string[];
  waiting_for_stale_days: number;
  default_grouping: string;
  show_completed_today: boolean;
}

export interface GardenCounts {
  inbox: number;
  actions: number;
  projects: number;
  waiting: number;
}

export interface ProjectDetail {
  project: ProjectItem;
  actions: ActionItem[];
  waiting: WaitingItem[];
}

export type GardenList = 'inbox' | 'actions' | 'projects' | 'waiting' | 'someday';

export type GardenView =
  | { kind: 'inbox' }
  | { kind: 'actions' }
  | { kind: 'projects' }
  | { kind: 'waiting' }
  | { kind: 'someday' }
  | { kind: 'project-detail'; id: string }
  | { kind: 'review' };

export type ProcessTarget =
  | {
      kind: 'next_action';
      context?: string | null;
      project?: string | null;
      energy?: string | null;
      duration?: string | null;
    }
  | {
      kind: 'project';
      outcome?: string | null;
      first_action?: string | null;
      action_context?: string | null;
    }
  | { kind: 'waiting_for'; from?: string | null; project?: string | null }
  | { kind: 'someday'; area?: string | null }
  | { kind: 'reference'; note_path: string }
  | { kind: 'trash' };

export type ActionGrouping = 'context' | 'project' | 'energy' | 'duration';

export interface ActionFilters {
  context?: string;
  project?: string;
  energy?: string;
  duration?: string;
}
