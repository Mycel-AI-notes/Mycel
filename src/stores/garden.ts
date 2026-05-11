import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import { useVaultStore } from './vault';
import type {
  ActionFilters,
  ActionGrouping,
  ActionItem,
  GardenConfig,
  GardenCounts,
  GardenList,
  InboxItem,
  ProcessTarget,
  ProjectDetail,
  ProjectItem,
  SomedayItem,
  WaitingItem,
} from '@/types/garden';

export interface GardenUIState {
  /** Sidebar Garden section open/closed. */
  sectionOpen: boolean;
  /** Quick-capture Cmd+I modal visibility. */
  captureOpen: boolean;
}

interface GardenState extends GardenUIState {
  // ---- Cached data ----
  counts: GardenCounts;
  inbox: InboxItem[];
  actions: ActionItem[];
  projects: ProjectItem[];
  waiting: WaitingItem[];
  someday: SomedayItem[];
  config: GardenConfig | null;

  // ---- UI prefs ----
  grouping: ActionGrouping;
  filters: ActionFilters;
  hideCompleted: boolean;

  // ---- Navigation ----
  toggleSection: () => void;
  openCapture: () => void;
  closeCapture: () => void;

  // ---- Loaders ----
  refreshCounts: () => Promise<void>;
  refreshAll: () => Promise<void>;
  loadInbox: () => Promise<void>;
  loadActions: () => Promise<void>;
  loadProjects: () => Promise<void>;
  loadWaiting: () => Promise<void>;
  loadSomeday: () => Promise<void>;
  loadConfig: () => Promise<void>;

  // ---- Inbox ----
  capture: (text: string) => Promise<string>;
  updateInbox: (
    id: string,
    updates: { text?: string; page?: string | null; source?: string | null; energy_hint?: string | null },
  ) => Promise<void>;
  deleteInbox: (id: string) => Promise<void>;
  processInbox: (id: string, target: ProcessTarget) => Promise<void>;

  // ---- Actions ----
  addAction: (item: {
    action: string;
    context?: string;
    project?: string | null;
    energy?: string | null;
    duration?: string | null;
    page?: string | null;
  }) => Promise<string>;
  updateAction: (
    id: string,
    updates: {
      action?: string;
      context?: string;
      project?: string | null;
      energy?: string | null;
      duration?: string | null;
      page?: string | null;
    },
  ) => Promise<void>;
  completeAction: (id: string, done: boolean) => Promise<void>;
  deleteAction: (id: string) => Promise<void>;

  // ---- Projects ----
  addProject: (item: {
    title: string;
    outcome?: string;
    deadline?: string | null;
    area?: string | null;
    page?: string | null;
  }) => Promise<string>;
  updateProject: (
    id: string,
    updates: {
      title?: string;
      outcome?: string;
      status?: string;
      deadline?: string | null;
      area?: string | null;
      page?: string | null;
    },
  ) => Promise<void>;
  deleteProject: (id: string) => Promise<void>;
  loadProjectDetail: (id: string) => Promise<ProjectDetail>;

  // ---- Waiting ----
  addWaiting: (item: {
    what: string;
    from?: string;
    since?: string | null;
    project?: string | null;
    page?: string | null;
  }) => Promise<string>;
  updateWaiting: (
    id: string,
    updates: {
      what?: string;
      from?: string;
      since?: string;
      project?: string | null;
      page?: string | null;
    },
  ) => Promise<void>;
  completeWaiting: (id: string, done: boolean) => Promise<void>;
  deleteWaiting: (id: string) => Promise<void>;

  // ---- Someday ----
  addSomeday: (item: {
    text: string;
    area?: string | null;
    page?: string | null;
  }) => Promise<string>;
  updateSomeday: (
    id: string,
    updates: { text?: string; area?: string | null; page?: string | null },
  ) => Promise<void>;
  deleteSomeday: (id: string) => Promise<void>;

  // ---- Config / pages ----
  setConfig: (config: GardenConfig) => Promise<void>;
  bindPage: (list: GardenList, item_id: string, note_path: string | null) => Promise<void>;
  createPage: (
    list: GardenList,
    item_id: string,
    note_path: string,
    title: string,
  ) => Promise<void>;

  setGrouping: (g: ActionGrouping) => void;
  setFilters: (f: Partial<ActionFilters>) => void;
  clearFilters: () => void;
  setHideCompleted: (v: boolean) => void;

  /** Drop everything — called when the vault closes. */
  reset: () => void;
}

const EMPTY_COUNTS: GardenCounts = { inbox: 0, actions: 0, projects: 0, waiting: 0 };

// Wrap each invoke so refresh is opportunistic — backend errors propagate but
// counts/lists keep flowing instead of getting stuck on stale data.
async function safe<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p;
  } catch (e) {
    console.warn('garden invoke failed:', e);
    return fallback;
  }
}

export const useGardenStore = create<GardenState>((set, get) => ({
  // Sidebar section starts collapsed so the file tree owns the space until
  // the user opts into Garden. Restored from localStorage below.
  sectionOpen: typeof window !== 'undefined'
    ? window.localStorage.getItem('mycel.garden.sectionOpen') === '1'
    : false,
  captureOpen: false,
  counts: EMPTY_COUNTS,
  inbox: [],
  actions: [],
  projects: [],
  waiting: [],
  someday: [],
  config: null,
  grouping: 'context',
  filters: {},
  hideCompleted: false,

  toggleSection: () => set((s) => {
    const next = !s.sectionOpen;
    if (typeof window !== 'undefined') {
      window.localStorage.setItem('mycel.garden.sectionOpen', next ? '1' : '0');
    }
    return { sectionOpen: next };
  }),
  openCapture: () => set({ captureOpen: true }),
  closeCapture: () => set({ captureOpen: false }),

  refreshCounts: async () => {
    const counts = await safe(invoke<GardenCounts>('garden_counts'), EMPTY_COUNTS);
    set({ counts });
  },

  refreshAll: async () => {
    await Promise.all([
      get().loadInbox(),
      get().loadActions(),
      get().loadProjects(),
      get().loadWaiting(),
      get().loadSomeday(),
      get().loadConfig(),
      get().refreshCounts(),
    ]);
  },

  loadInbox: async () => {
    const inbox = await safe(invoke<InboxItem[]>('garden_inbox_list'), []);
    set({ inbox });
  },
  loadActions: async () => {
    const actions = await safe(invoke<ActionItem[]>('garden_actions_list'), []);
    set({ actions });
  },
  loadProjects: async () => {
    const projects = await safe(invoke<ProjectItem[]>('garden_projects_list'), []);
    set({ projects });
  },
  loadWaiting: async () => {
    const waiting = await safe(invoke<WaitingItem[]>('garden_waiting_list'), []);
    set({ waiting });
  },
  loadSomeday: async () => {
    const someday = await safe(invoke<SomedayItem[]>('garden_someday_list'), []);
    set({ someday });
  },
  loadConfig: async () => {
    const config = await safe(invoke<GardenConfig>('garden_config_get'), null as unknown as GardenConfig);
    if (config) set({ config });
  },

  capture: async (text) => {
    const id = await invoke<string>('garden_inbox_capture', { text });
    await Promise.all([get().loadInbox(), get().refreshCounts()]);
    return id;
  },
  updateInbox: async (id, updates) => {
    await invoke('garden_inbox_update', { id, updates });
    await get().loadInbox();
  },
  deleteInbox: async (id) => {
    await invoke('garden_inbox_delete', { id });
    await Promise.all([get().loadInbox(), get().refreshCounts()]);
  },
  processInbox: async (id, target) => {
    await invoke('garden_inbox_process', { id, target });
    await Promise.all([
      get().loadInbox(),
      get().loadActions(),
      get().loadProjects(),
      get().loadWaiting(),
      get().loadSomeday(),
      get().refreshCounts(),
    ]);
    // Reference creates a new note in the vault — refresh the file tree so
    // it shows up in the sidebar.
    if (target.kind === 'reference') {
      await useVaultStore.getState().refreshTree();
    }
  },

  addAction: async (item) => {
    const id = await invoke<string>('garden_action_add', { item });
    await Promise.all([get().loadActions(), get().refreshCounts()]);
    return id;
  },
  updateAction: async (id, updates) => {
    await invoke('garden_action_update', { id, updates });
    await get().loadActions();
  },
  completeAction: async (id, done) => {
    await invoke('garden_action_complete', { id, done });
    await Promise.all([get().loadActions(), get().refreshCounts()]);
  },
  deleteAction: async (id) => {
    await invoke('garden_action_delete', { id });
    await Promise.all([get().loadActions(), get().refreshCounts()]);
  },

  addProject: async (item) => {
    const id = await invoke<string>('garden_project_add', { item });
    await Promise.all([get().loadProjects(), get().refreshCounts()]);
    return id;
  },
  updateProject: async (id, updates) => {
    await invoke('garden_project_update', { id, updates });
    await Promise.all([get().loadProjects(), get().loadActions(), get().loadWaiting(), get().refreshCounts()]);
  },
  deleteProject: async (id) => {
    await invoke('garden_project_delete', { id });
    await Promise.all([get().loadProjects(), get().refreshCounts()]);
  },
  loadProjectDetail: async (id) => {
    return await invoke<ProjectDetail>('garden_project_detail', { id });
  },

  addWaiting: async (item) => {
    const id = await invoke<string>('garden_waiting_add', { item });
    await Promise.all([get().loadWaiting(), get().refreshCounts()]);
    return id;
  },
  updateWaiting: async (id, updates) => {
    await invoke('garden_waiting_update', { id, updates });
    await get().loadWaiting();
  },
  completeWaiting: async (id, done) => {
    await invoke('garden_waiting_complete', { id, done });
    await Promise.all([get().loadWaiting(), get().refreshCounts()]);
  },
  deleteWaiting: async (id) => {
    await invoke('garden_waiting_delete', { id });
    await Promise.all([get().loadWaiting(), get().refreshCounts()]);
  },

  addSomeday: async (item) => {
    const id = await invoke<string>('garden_someday_add', { item });
    await get().loadSomeday();
    return id;
  },
  updateSomeday: async (id, updates) => {
    await invoke('garden_someday_update', { id, updates });
    await get().loadSomeday();
  },
  deleteSomeday: async (id) => {
    await invoke('garden_someday_delete', { id });
    await get().loadSomeday();
  },

  setConfig: async (config) => {
    await invoke('garden_config_update', { config });
    set({ config });
  },
  bindPage: async (list, item_id, note_path) => {
    await invoke('garden_bind_page', { list, itemId: item_id, notePath: note_path });
    // Refresh whichever list was touched.
    switch (list) {
      case 'inbox': await get().loadInbox(); break;
      case 'actions': await get().loadActions(); break;
      case 'projects': await get().loadProjects(); break;
      case 'waiting': await get().loadWaiting(); break;
      case 'someday': await get().loadSomeday(); break;
    }
  },
  createPage: async (list, item_id, note_path, title) => {
    await invoke('garden_create_page', {
      list,
      itemId: item_id,
      notePath: note_path,
      title,
    });
    await useVaultStore.getState().refreshTree();
    switch (list) {
      case 'inbox': await get().loadInbox(); break;
      case 'actions': await get().loadActions(); break;
      case 'projects': await get().loadProjects(); break;
      case 'waiting': await get().loadWaiting(); break;
      case 'someday': await get().loadSomeday(); break;
    }
  },

  setGrouping: (g) => set({ grouping: g }),
  setFilters: (f) => set((s) => ({ filters: { ...s.filters, ...f } })),
  clearFilters: () => set({ filters: {} }),
  setHideCompleted: (v) => set({ hideCompleted: v }),

  reset: () => set({
    captureOpen: false,
    counts: EMPTY_COUNTS,
    inbox: [],
    actions: [],
    projects: [],
    waiting: [],
    someday: [],
    config: null,
    filters: {},
  }),
}));
