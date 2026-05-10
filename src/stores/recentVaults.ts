import { create } from 'zustand';
import { persist } from 'zustand/middleware';

const MAX_RECENTS = 8;

interface RecentVaultsState {
  recents: string[];
  lastOpened: string | null;

  push: (path: string) => void;
  remove: (path: string) => void;
  clearLastOpened: () => void;
}

export const useRecentVaults = create<RecentVaultsState>()(
  persist(
    (set) => ({
      recents: [],
      lastOpened: null,

      push: (path) =>
        set((s) => {
          const without = s.recents.filter((p) => p !== path);
          return {
            recents: [path, ...without].slice(0, MAX_RECENTS),
            lastOpened: path,
          };
        }),

      remove: (path) =>
        set((s) => ({
          recents: s.recents.filter((p) => p !== path),
          lastOpened: s.lastOpened === path ? null : s.lastOpened,
        })),

      clearLastOpened: () => set({ lastOpened: null }),
    }),
    { name: 'mycel-recent-vaults' },
  ),
);

export function vaultDisplayName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}
