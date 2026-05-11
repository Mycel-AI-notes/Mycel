import { create } from 'zustand';
import { invoke } from '@tauri-apps/api/core';
import type { FileEntry, Note, SaveCheckedResult, SaveConflict, Tab } from '@/types';
import { reparseBody } from '@/lib/markdown-parse';
import { displayName } from '@/lib/note-name';
import { replaceEditorContent } from '@/lib/editor-registry';
import { useRecentVaults } from './recentVaults';
import { useSyncStore } from './sync';
import { useCryptoStore } from './crypto';

interface VaultState {
  vaultRoot: string | null;
  fileTree: FileEntry[];
  openTabs: Tab[];
  activeTabPath: string | null;
  noteCache: Map<string, Note>;
  /** Bumped on every persisted save — lets panels (backlinks, etc.) refetch. */
  vaultVersion: number;
  /** Set when a save was refused because the on-disk file changed under us
   *  (typically because sync pulled a remote edit while the user was
   *  typing). The UI mounts a resolution modal off this; the four resolver
   *  actions below clear it. */
  pendingConflict: SaveConflict | null;

  openVault: (path: string) => Promise<void>;
  closeVault: () => void;
  refreshTree: () => Promise<void>;
  /** Re-read the file tree and re-fetch content for every non-dirty open
   *  tab. Called after a sync pull so the UI reflects what other devices
   *  wrote, and so the editor isn't holding a stale base that the next
   *  save would write back over the freshly pulled content. */
  reloadFromDisk: () => Promise<void>;
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
  /** Update open tabs / noteCache after a file was renamed on disk by some
   *  other action (e.g. encrypt/decrypt, which writes `<name>.md.age` and
   *  removes `<name>.md`). The next save would otherwise target a stale
   *  path with a stale `disk_hash` and trigger a spurious conflict. */
  relocateNote: (oldPath: string, newPath: string) => Promise<void>;
  markDirty: (path: string, dirty: boolean) => void;
  /** Drop every cached body and every open tab for `.md.age` notes.
   *  Called by the crypto store when the vault is locked so plaintext
   *  doesn't outlive the in-memory X25519 secret. */
  purgeEncryptedFromMemory: () => void;

  // --- conflict resolution actions ---
  /** Discard local edits and load the disk version into the editor. */
  resolveConflictReload: () => Promise<void>;
  /** Overwrite the disk version with the user's local content. */
  resolveConflictKeepMine: () => Promise<void>;
  /** Write a merged file containing both versions wrapped in standard git
   *  conflict markers, so the user can edit and reconcile in place. */
  resolveConflictKeepBoth: () => Promise<void>;
  /** Cancel without saving — leaves the editor dirty so the user can keep
   *  editing or hit save again. */
  dismissConflict: () => void;
}

export const useVaultStore = create<VaultState>((set, get) => ({
  vaultRoot: null,
  fileTree: [],
  openTabs: [],
  activeTabPath: null,
  noteCache: new Map(),
  vaultVersion: 0,
  pendingConflict: null,

  openVault: async (path) => {
    const tree = await invoke<FileEntry[]>('vault_open', { path });
    set({
      vaultRoot: path,
      fileTree: tree,
      openTabs: [],
      activeTabPath: null,
      noteCache: new Map(),
      vaultVersion: 0,
      pendingConflict: null,
    });
    useRecentVaults.getState().push(path);

    // Refresh sync state for the new vault, and try an opportunistic initial
    // sync so the user sees up-to-date notes from other devices.
    await useSyncStore.getState().loadForVault();
    const { config, status } = useSyncStore.getState();
    if (config?.auto_sync && status?.configured && status.has_token) {
      void useSyncStore.getState().syncNow();
    }

    // The Rust side has cleared any previous vault's crypto session; pull the
    // fresh per-vault status so the UI shows the correct lock state.
    useCryptoStore.getState().reset_for_new_vault();
    void useCryptoStore.getState().refresh();
  },

  closeVault: () => {
    set({
      vaultRoot: null,
      fileTree: [],
      openTabs: [],
      activeTabPath: null,
      noteCache: new Map(),
      vaultVersion: 0,
      pendingConflict: null,
    });
    useRecentVaults.getState().clearLastOpened();
    useSyncStore.getState().reset();
    useCryptoStore.getState().reset_for_new_vault();
  },

  refreshTree: async () => {
    const tree = await invoke<FileEntry[]>('vault_get_tree');
    set({ fileTree: tree });
  },

  reloadFromDisk: async () => {
    const tree = await invoke<FileEntry[]>('vault_get_tree');
    const { openTabs, noteCache } = get();

    const existingFiles = new Set<string>();
    const walk = (entries: FileEntry[]) => {
      for (const e of entries) {
        if (!e.is_dir) existingFiles.add(e.path);
        if (e.children) walk(e.children);
      }
    };
    walk(tree);

    const nextCache = new Map<string, Note>();
    const editorPatches: Array<{ path: string; content: string }> = [];
    for (const tab of openTabs) {
      if (tab.isDirty) {
        const cached = noteCache.get(tab.path);
        if (cached) nextCache.set(tab.path, cached);
        continue;
      }
      if (!existingFiles.has(tab.path)) continue;
      try {
        const note = await invoke<Note>('note_read', { path: tab.path });
        const reparsed = reparseBody(note.content);
        nextCache.set(tab.path, {
          ...note,
          parsed: { ...note.parsed, ...reparsed },
        });
        // The CodeMirror view holds the old text — push the freshly pulled
        // content into it so the user actually sees the remote changes
        // without reopening the tab.
        editorPatches.push({ path: tab.path, content: note.content });
      } catch {
        // Encrypted note while vault is locked, or transient read error.
        // Leave it out of the cache — openNote will re-read on demand.
      }
    }

    set((s) => {
      const filteredTabs = s.openTabs.filter(
        (t) => t.isDirty || existingFiles.has(t.path),
      );
      const activeStillOpen = filteredTabs.some(
        (t) => t.path === s.activeTabPath,
      );
      return {
        fileTree: tree,
        noteCache: nextCache,
        openTabs: filteredTabs,
        activeTabPath: activeStillOpen
          ? s.activeTabPath
          : filteredTabs[0]?.path ?? null,
        vaultVersion: s.vaultVersion + 1,
      };
    });

    // Apply patches after the state update so the editor's updateListener
    // sees the new noteCache when it fires `updateNoteLive` synchronously.
    for (const patch of editorPatches) {
      if (replaceEditorContent(patch.path, patch.content)) {
        // The dispatch above triggered the listener which marked the tab
        // dirty — undo that, the content is freshly synced and clean.
        set((s) => ({
          openTabs: s.openTabs.map((t) =>
            t.path === patch.path ? { ...t, isDirty: false } : t,
          ),
        }));
      }
    }
  },

  openNote: async (path, options) => {
    const preview = options?.preview ?? false;
    const { openTabs, noteCache } = get();

    if (!noteCache.has(path)) {
      // Encrypted note + locked vault: pop the unlock prompt instead of
      // failing silently. After the user types the passphrase, the
      // promise resolves and we proceed straight to note_read.
      if (path.endsWith('.md.age')) {
        const crypto = useCryptoStore.getState();
        if (!crypto.status?.unlocked) {
          try {
            await crypto.requireUnlock();
          } catch {
            // User closed the panel without unlocking. Drop the open
            // attempt quietly — they explicitly cancelled.
            return;
          }
        }
      }
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
    const title = note.parsed.meta.title ?? displayName(path);

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
    const cached = get().noteCache.get(path);
    const expectedHash = cached?.disk_hash ?? '';
    const result = await invoke<SaveCheckedResult>('note_save_checked', {
      path,
      content,
      expectedDiskHash: expectedHash,
    });

    if (result.kind === 'conflict') {
      // Don't write. Park the user's content in `pendingConflict` and let the
      // resolution dialog decide. We deliberately do not auto-trigger sync —
      // there's nothing new to push and the conflict came from a recent pull.
      set({
        pendingConflict: {
          path,
          localContent: content,
          diskContent: result.disk_content,
          diskHash: result.disk_hash,
        },
      });
      return;
    }

    const existing = cached?.parsed;
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
        encrypted: cached?.encrypted,
        disk_hash: result.disk_hash,
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
    useSyncStore.getState().scheduleAutoSync();
  },

  updateNoteLive: (path, content) => {
    const cached = get().noteCache.get(path);
    if (!cached) return;
    if (cached.content === content) return;
    const reparsed = reparseBody(content);
    set((s) => {
      const next = new Map(s.noteCache);
      next.set(path, {
        ...cached,
        path,
        content,
        parsed: { meta: cached.parsed.meta, ...reparsed },
      });
      return { noteCache: next };
    });
  },

  resolveConflictReload: async () => {
    const conflict = get().pendingConflict;
    if (!conflict) return;
    const reparsed = reparseBody(conflict.diskContent);
    const existing = get().noteCache.get(conflict.path);
    set((s) => {
      const next = new Map(s.noteCache);
      next.set(conflict.path, {
        path: conflict.path,
        content: conflict.diskContent,
        parsed: { meta: existing?.parsed.meta ?? { tags: [] }, ...reparsed },
        encrypted: existing?.encrypted,
        disk_hash: conflict.diskHash,
      });
      return {
        noteCache: next,
        vaultVersion: s.vaultVersion + 1,
        openTabs: s.openTabs.map((t) =>
          t.path === conflict.path ? { ...t, isDirty: false } : t,
        ),
        pendingConflict: null,
      };
    });
    if (replaceEditorContent(conflict.path, conflict.diskContent)) {
      // Editor's updateListener fired and re-marked the tab dirty — clear it.
      set((s) => ({
        openTabs: s.openTabs.map((t) =>
          t.path === conflict.path ? { ...t, isDirty: false } : t,
        ),
      }));
    }
  },

  resolveConflictKeepMine: async () => {
    const conflict = get().pendingConflict;
    if (!conflict) return;
    // Re-issue the save against the *current* disk hash so the backend
    // accepts the write. This is the explicit "I want my version" branch.
    const result = await invoke<SaveCheckedResult>('note_save_checked', {
      path: conflict.path,
      content: conflict.localContent,
      expectedDiskHash: conflict.diskHash,
    });
    if (result.kind === 'conflict') {
      // Disk changed again between us showing the dialog and the user
      // clicking. Refresh the dialog with the newer disk content.
      set({
        pendingConflict: {
          path: conflict.path,
          localContent: conflict.localContent,
          diskContent: result.disk_content,
          diskHash: result.disk_hash,
        },
      });
      return;
    }
    const existing = get().noteCache.get(conflict.path);
    const reparsed = reparseBody(conflict.localContent);
    set((s) => {
      const next = new Map(s.noteCache);
      next.set(conflict.path, {
        path: conflict.path,
        content: conflict.localContent,
        parsed: { meta: existing?.parsed.meta ?? { tags: [] }, ...reparsed },
        encrypted: existing?.encrypted,
        disk_hash: result.disk_hash,
      });
      return {
        noteCache: next,
        vaultVersion: s.vaultVersion + 1,
        openTabs: s.openTabs.map((t) =>
          t.path === conflict.path ? { ...t, isDirty: false } : t,
        ),
        pendingConflict: null,
      };
    });
    useSyncStore.getState().scheduleAutoSync();
  },

  resolveConflictKeepBoth: async () => {
    const conflict = get().pendingConflict;
    if (!conflict) return;
    const merged =
      `<<<<<<< local\n${conflict.localContent}\n=======\n${conflict.diskContent}\n>>>>>>> remote\n`;
    const result = await invoke<SaveCheckedResult>('note_save_checked', {
      path: conflict.path,
      content: merged,
      expectedDiskHash: conflict.diskHash,
    });
    if (result.kind === 'conflict') {
      set({
        pendingConflict: {
          path: conflict.path,
          localContent: conflict.localContent,
          diskContent: result.disk_content,
          diskHash: result.disk_hash,
        },
      });
      return;
    }
    const existing = get().noteCache.get(conflict.path);
    const reparsed = reparseBody(merged);
    set((s) => {
      const next = new Map(s.noteCache);
      next.set(conflict.path, {
        path: conflict.path,
        content: merged,
        parsed: { meta: existing?.parsed.meta ?? { tags: [] }, ...reparsed },
        encrypted: existing?.encrypted,
        disk_hash: result.disk_hash,
      });
      // Keep the tab marked dirty: the user still needs to remove conflict
      // markers manually before the next save.
      return {
        noteCache: next,
        vaultVersion: s.vaultVersion + 1,
        openTabs: s.openTabs.map((t) =>
          t.path === conflict.path ? { ...t, isDirty: true } : t,
        ),
        pendingConflict: null,
      };
    });
    replaceEditorContent(conflict.path, merged);
  },

  dismissConflict: () => {
    set({ pendingConflict: null });
  },

  createNote: async (path) => {
    const note = await invoke<Note>('note_create', { path });
    set((s) => {
      const next = new Map(s.noteCache);
      next.set(path, note);
      const title = displayName(path);
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
      const newTitle = displayName(newPath);
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

  relocateNote: async (oldPath, newPath) => {
    if (oldPath === newPath) return;
    const { openTabs, activeTabPath } = get();
    const oldTab = openTabs.find((t) => t.path === oldPath);
    if (!oldTab) {
      // Nothing was open against the old path — caller still wants the tree
      // refreshed so the sidebar picks up the rename.
      await get().refreshTree();
      return;
    }
    const wasDirty = oldTab.isDirty;

    // Re-read the new file so disk_hash, encrypted flag and parsed metadata
    // all reflect what's actually on disk now. Encrypt/decrypt rewrites the
    // bytes entirely, so the previous cached hash is unusable.
    let newNote: Note | null = null;
    try {
      const note = await invoke<Note>('note_read', { path: newPath });
      const reparsed = reparseBody(note.content);
      newNote = { ...note, parsed: { ...note.parsed, ...reparsed } };
    } catch {
      // Read can fail (e.g. encrypted note while the vault is locked).
      // Leave the cache empty for `newPath`; openNote will re-fetch on demand.
    }

    const newTitle = newNote?.parsed.meta.title ?? displayName(newPath);

    set((s) => {
      const nextCache = new Map(s.noteCache);
      nextCache.delete(oldPath);
      if (newNote) nextCache.set(newPath, newNote);
      return {
        noteCache: nextCache,
        openTabs: s.openTabs.map((t) =>
          t.path === oldPath ? { ...t, path: newPath, title: newTitle } : t,
        ),
        activeTabPath: activeTabPath === oldPath ? newPath : activeTabPath,
      };
    });

    // For a clean tab, sync the editor's buffer with the freshly read content
    // (decrypt may produce subtly different bytes — trailing newline, etc.).
    // For a dirty tab, leave the user's in-flight edits alone.
    if (!wasDirty && newNote) {
      if (replaceEditorContent(newPath, newNote.content)) {
        set((s) => ({
          openTabs: s.openTabs.map((t) =>
            t.path === newPath ? { ...t, isDirty: false } : t,
          ),
        }));
      }
    }

    await get().refreshTree();
  },

  markDirty: (path, dirty) => {
    set((s) => ({
      openTabs: s.openTabs.map((t) => (t.path === path ? { ...t, isDirty: dirty } : t)),
    }));
  },

  purgeEncryptedFromMemory: () => {
    set((s) => {
      const nextCache = new Map(s.noteCache);
      for (const key of Array.from(nextCache.keys())) {
        if (key.endsWith('.md.age')) nextCache.delete(key);
      }
      const nextTabs = s.openTabs.filter((t) => !t.path.endsWith('.md.age'));
      const activeStillOpen = nextTabs.some((t) => t.path === s.activeTabPath);
      return {
        noteCache: nextCache,
        openTabs: nextTabs,
        activeTabPath: activeStillOpen ? s.activeTabPath : nextTabs[0]?.path ?? null,
      };
    });
  },
}));
