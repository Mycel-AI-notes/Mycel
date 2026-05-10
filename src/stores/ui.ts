import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'light' | 'dark' | 'system';

export type Palette = 'moss' | 'amber' | 'azure' | 'plum' | 'coral';

export const PALETTES: { id: Palette; label: string; swatch: string }[] = [
  { id: 'moss',  label: 'Moss',  swatch: '#C8F52A' },
  { id: 'amber', label: 'Amber', swatch: '#FFB84D' },
  { id: 'azure', label: 'Azure', swatch: '#58A6FF' },
  { id: 'plum',  label: 'Plum',  swatch: '#B292FF' },
  { id: 'coral', label: 'Coral', swatch: '#FF7E6B' },
];

export const SIDEBAR_MIN_WIDTH = 160;
export const SIDEBAR_MAX_WIDTH = 600;
export const SIDEBAR_DEFAULT_WIDTH = 224;

interface UIState {
  theme: Theme;
  palette: Palette;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  rightPanelCollapsed: boolean;
  rightPanelTab: 'backlinks' | 'outline' | 'tags';

  setTheme: (theme: Theme) => void;
  setPalette: (palette: Palette) => void;
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
      palette: 'moss',
      sidebarCollapsed: false,
      sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
      rightPanelCollapsed: false,
      rightPanelTab: 'backlinks',

      setTheme: (theme) => set({ theme }),
      setPalette: (palette) => set({ palette }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarWidth: (width) => set({ sidebarWidth: clampSidebarWidth(width) }),
      toggleRightPanel: () => set((s) => ({ rightPanelCollapsed: !s.rightPanelCollapsed })),
      setRightPanelTab: (tab) => set({ rightPanelTab: tab }),
    }),
    {
      name: 'mycel-ui',
      partialize: (s) => ({
        sidebarWidth: s.sidebarWidth,
        theme: s.theme,
        palette: s.palette,
      }),
    },
  ),
);
