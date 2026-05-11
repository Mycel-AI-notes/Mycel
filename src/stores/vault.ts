import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { FileEntry, Note, Tab } from '@/types';
import { reparseBody } from '@/lib/markdown-parse';
import { useRecentVaults } from './recentVaults';
import { useSyncStore } from './sync';

interface VaultState {
  vaultRoot: string | null;
  fileTree: FileEntry[];
  openTabs: Tab[];
  activeTabPath: string | null;
  noteCache: Map<string, Note>;
  /** Bumped on every persisted save — lets panels (backlinks, etc.) refetch. */
  vaultVersion: number;

  openVault: (path: string) => Promise<void>;
  closeVault: () => void;
  refreshTree: () => Promise<void>;
  openNote: (path: string, options?: { preview?: boolean }) => Promise<void>;
  closeTab: (path: string) => void;
  setActiveTab: (path: string) => void;
  pinTab: (path: string) => void;
  saveNote: (path: string, content: string) => Promise<void>;
  /** Update in-memory cached content + reparsed body so live panels (outline,
   *  tags, wikilinks) reflect what the user is typing without hitting disk. */
  updateNoteLive: (path: string, content: string) => void;
  createNote: (path: string) => Promise<void>;
  createFolder: (path: string) => Promise<void>;
  deleteNote: (path: string) => Promise<void>;
  renameNote: (oldPath: string, newPath: string) => Promise<void>;
  markDirty: (path: string, dirty: boolean) => void;
}

export const useVaultStore = create<VaultState>((set, get) => ({
  vaultRoot: null,
  fileTree: [],
  openTabs: [],
  activeTabPath: null,
  noteCache: new Map(),
  vaultVersion: 0,

  openVault: async (path) => {
    const tree = await invoke<FileEntry[]>('vault_open', { path });
    set({
      vaultRoot: path,
      fileTree: tree,
      openTabs: [],
      activeTabPath: null,
      noteCache: new Map(),
      vaultVersion: 0,
    });
    useRecentVaults.getState().push(path);

    // Refresh sync state for the new vault, and try an opportunistic initial
    // sync so the user sees up-to-date notes from other devices.
    await useSyncStore.getState().loadForVault();
    const { config, status } = useSyncStore.getState();
    if (config?.auto_sync && status?.configured && status.has_token) {
      void useSyncStore.getState().syncNow();
    }
  },

  closeVault: () => {
    set({
      vaultRoot: null,
      fileTree: [],
      openTabs: [],
      activeTabPath: null,
      noteCache: new Map(),
      vaultVersion: 0,
    });
    useRecentVaults.getState().clearLastOpened();
    useSyncStore.getState().reset();
  },

  refreshTree: async () => {
    const tree = await invoke<FileEntry[]>('vault_get_tree');
    set({ fileTree: tree });
  },

  openNote: async (path, options) => {
    const preview = options?.preview ?? false;
    const { openTabs, noteCache } = get();

    if (!noteCache.has(path)) {
      const note = await invoke<Note>('note_read', { path });
      // Overlay TS-side reparse so headings carry line numbers from the get-go
      // (the Rust parser uses pulldown_cmark events without positions).
      const reparsed = reparseBody(note.content);
      set((s) => {
        const next = new Map(s.noteCache);
        next.set(path, {
          ...note,
          parsed: { ...note.parsed, ...reparsed },
        });
        return { noteCache: next };
      });
    }

    const alreadyOpen = openTabs.find((t) => t.path === path);
    const note = get().noteCache.get(path)!;
    const title = note.parsed.meta.title ?? path.split('/').pop()?.replace(/\.md$/, '') ?? path;

    if (alreadyOpen) {
      // If user explicitly re-opens (non-preview) an existing preview tab,
      // promote it. Otherwise leave it alone.
      if (alreadyOpen.isPreview && !preview) {
        set((s) => ({
          openTabs: s.openTabs.map((t) =>
            t.path === path ? { ...t, isPreview: false } : t,
          ),
        }));
      }
    } else if (preview) {
      // Replace the existing preview tab (if any), otherwise append.
      const existingIdx = openTabs.findIndex((t) => t.isPreview);
      if (existingIdx >= 0) {
        set((s) => ({
          openTabs: s.openTabs.map((t, i) =>
            i === existingIdx ? { path, title, isDirty: false, isPreview: true } : t,
          ),
        }));
      } else {
        set((s) => ({
          openTabs: [...s.openTabs, { path, title, isDirty: false, isPreview: true }],
        }));
      }
    } else {
      set((s) => ({
        openTabs: [...s.openTabs, { path, title, isDirty: false, isPreview: false }],
      }));
    }
    set({ activeTabPath: path });
  },

  pinTab: (path) => {
    set((s) => ({
      openTabs: s.openTabs.map((t) => (t.path === path ? { ...t, isPreview: false } : t)),
    }));
  },

  closeTab: (path) => {
    const { openTabs, activeTabPath } = get();
    const idx = openTabs.findIndex((t) => t.path === path);
    if (idx === -1) return;
    const next = openTabs.filter((t) => t.path !== path);
    let newActive = activeTabPath;
    if (activeTabPath === path) {
      newActive = next[Math.max(0, idx - 1)]?.path ?? null;
    }
    set({ openTabs: next, activeTabPath: newActive });
  },

  setActiveTab: (path) => set({ activeTabPath: path }),

  saveNote: async (path, content) => {
    await invoke('note_save', { path, content });
    useSyncStore.getState().scheduleAutoSync();
    const existing = get().noteCache.get(path)?.parsed;
    const reparsed = reparseBody(content);
    set((s) => {
      const next = new Map(s.noteCache);
      next.set(path, {
        path,
        content,
        parsed: {
          // Frontmatter meta is preserved from the previously parsed snapshot;
          // a deeper re-parse happens server-side on next note_read.
          meta: existing?.meta ?? { tags: [] },
          ...reparsed,
        },
      });
      return {
        noteCache: next,
        vaultVersion: s.vaultVersion + 1,
        // Saving promotes a preview tab to a regular pinned tab.
        openTabs: s.openTabs.map((t) =>
          t.path === path ? { ...t, isDirty: false, isPreview: false } : t,
        ),
      };
    });
  },

  updateNoteLive: (path, content) => {
    const cached = get().noteCache.get(path);
    if (!cached) return;
    if (cached.content === content) return;
    const reparsed = reparseBody(content);
    set((s) => {
      const next = new Map(s.noteCache);
      next.set(path, {
        path,
        content,
        parsed: { meta: cached.parsed.meta, ...reparsed },
      });
      return { noteCache: next };
    });
  },

  createNote: async (path) => {
    const note = await invoke<Note>('note_create', { path });
    set((s) => {
      const next = new Map(s.noteCache);
      next.set(path, note);
      const title = path.split('/').pop()?.replace(/\.md$/, '') ?? path;
      return {
        noteCache: next,
        openTabs: [...s.openTabs, { path, title, isDirty: false }],
        activeTabPath: path,
      };
    });
    await get().refreshTree();
  },

  createFolder: async (path) => {
    await invoke('folder_create', { path });
    await get().refreshTree();
  },

  deleteNote: async (path) => {
    await invoke('note_delete', { path });
    get().closeTab(path);
    await get().refreshTree();
  },

  renameNote: async (oldPath, newPath) => {
    await invoke('note_rename', { oldPath, newPath });
    const note = get().noteCache.get(oldPath);
    set((s) => {
      const next = new Map(s.noteCache);
      next.delete(oldPath);
      if (note) next.set(newPath, { ...note, path: newPath });
      const newTitle = newPath.split('/').pop()?.replace(/\.md$/, '') ?? newPath;
      return {
        noteCache: next,
        openTabs: s.openTabs.map((t) =>
          t.path === oldPath ? { ...t, path: newPath, title: newTitle } : t,
        ),
        activeTabPath: s.activeTabPath === oldPath ? newPath : s.activeTabPath,
      };
    });
    await get().refreshTree();
  },

  markDirty: (path, dirty) => {
    set((s) => ({
      openTabs: s.openTabs.map((t) => (t.path === path ? { ...t, isDirty: dirty } : t)),
    }));
  },
}));
