import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'light' | 'dark' | 'system';

export const SIDEBAR_MIN_WIDTH = 160;
export const SIDEBAR_MAX_WIDTH = 600;
export const SIDEBAR_DEFAULT_WIDTH = 224;

interface UIState {
  theme: Theme;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  rightPanelCollapsed: boolean;
  rightPanelTab: 'backlinks' | 'outline' | 'tags';

  setTheme: (theme: Theme) => void;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  toggleRightPanel: () => void;
  setRightPanelTab: (tab: UIState['rightPanelTab']) => void;
}

const clampSidebarWidth = (w: number) =>
  Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(w)));

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      theme: 'dark',
      sidebarCollapsed: false,
      sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
      rightPanelCollapsed: false,
      rightPanelTab: 'backlinks',

      setTheme: (theme) => set({ theme }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarWidth: (width) => set({ sidebarWidth: clampSidebarWidth(width) }),
      toggleRightPanel: () => set((s) => ({ rightPanelCollapsed: !s.rightPanelCollapsed })),
      setRightPanelTab: (tab) => set({ rightPanelTab: tab }),
    }),
    {
      name: 'mycel-ui',
      partialize: (s) => ({ sidebarWidth: s.sidebarWidth }),
    },
  ),
);
