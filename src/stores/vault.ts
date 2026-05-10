import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { FileEntry, Note, Tab } from '@/types';

interface VaultState {
  vaultRoot: string | null;
  fileTree: FileEntry[];
  openTabs: Tab[];
  activeTabPath: string | null;
  noteCache: Map<string, Note>;

  openVault: (path: string) => Promise<void>;
  refreshTree: () => Promise<void>;
  openNote: (path: string) => Promise<void>;
  closeTab: (path: string) => void;
  setActiveTab: (path: string) => void;
  saveNote: (path: string, content: string) => Promise<void>;
  createNote: (path: string) => Promise<void>;
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

  openVault: async (path) => {
    const tree = await invoke<FileEntry[]>('vault_open', { path });
    set({ vaultRoot: path, fileTree: tree, openTabs: [], activeTabPath: null, noteCache: new Map() });
  },

  refreshTree: async () => {
    const tree = await invoke<FileEntry[]>('vault_get_tree');
    set({ fileTree: tree });
  },

  openNote: async (path) => {
    const { openTabs, noteCache } = get();

    if (!noteCache.has(path)) {
      const note = await invoke<Note>('note_read', { path });
      set((s) => {
        const next = new Map(s.noteCache);
        next.set(path, note);
        return { noteCache: next };
      });
    }

    const alreadyOpen = openTabs.find((t) => t.path === path);
    if (!alreadyOpen) {
      const note = get().noteCache.get(path)!;
      const title = note.parsed.meta.title ?? path.split('/').pop()?.replace(/\.md$/, '') ?? path;
      set((s) => ({
        openTabs: [...s.openTabs, { path, title, isDirty: false }],
      }));
    }
    set({ activeTabPath: path });
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
    const parsed = get().noteCache.get(path)?.parsed;
    set((s) => {
      const next = new Map(s.noteCache);
      if (parsed) next.set(path, { path, content, parsed });
      return {
        noteCache: next,
        openTabs: s.openTabs.map((t) => (t.path === path ? { ...t, isDirty: false } : t)),
      };
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
