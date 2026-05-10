import { create } from 'zustand';

type Theme = 'light' | 'dark' | 'system';

interface UIState {
  theme: Theme;
  sidebarCollapsed: boolean;
  rightPanelCollapsed: boolean;
  rightPanelTab: 'backlinks' | 'outline' | 'tags';

  setTheme: (theme: Theme) => void;
  toggleSidebar: () => void;
  toggleRightPanel: () => void;
  setRightPanelTab: (tab: UIState['rightPanelTab']) => void;
}

export const useUIStore = create<UIState>((set) => ({
  theme: 'dark',
  sidebarCollapsed: false,
  rightPanelCollapsed: false,
  rightPanelTab: 'backlinks',

  setTheme: (theme) => set({ theme }),
  toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
  toggleRightPanel: () => set((s) => ({ rightPanelCollapsed: !s.rightPanelCollapsed })),
  setRightPanelTab: (tab) => set({ rightPanelTab: tab }),
}));
