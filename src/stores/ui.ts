import { create } from 'zustand';
import { persist } from 'zustand/middleware';

type Theme = 'light' | 'dark' | 'system';

export type Palette = 'moss' | 'amber' | 'azure' | 'plum' | 'coral' | 'classic';

export const PALETTES: { id: Palette; label: string; swatch: string }[] = [
  { id: 'moss',    label: 'Moss',          swatch: '#C8F52A' },
  { id: 'plum',    label: 'Plum',          swatch: '#B292FF' },
  { id: 'coral',   label: 'Coral',         swatch: '#FF7E6B' },
  { id: 'amber',   label: 'Amber (Light)', swatch: '#E48A1A' },
  { id: 'azure',   label: 'Azure (Light)', swatch: '#3A82E2' },
  { id: 'classic', label: 'Classic',       swatch: '#ffffff' },
];

export const SIDEBAR_MIN_WIDTH = 160;
export const SIDEBAR_MAX_WIDTH = 600;
export const SIDEBAR_DEFAULT_WIDTH = 224;

/// Opt-in / opt-out switches for whole features. Persists across sessions
/// so a user who hides Garden never has to deal with it again.
export interface FeatureFlags {
  garden: boolean;
}

const DEFAULT_FEATURES: FeatureFlags = {
  garden: true,
};

interface UIState {
  theme: Theme;
  palette: Palette;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  rightPanelCollapsed: boolean;
  rightPanelTab: 'backlinks' | 'outline' | 'tags' | 'insights';
  features: FeatureFlags;
  settingsOpen: boolean;

  setTheme: (theme: Theme) => void;
  setPalette: (palette: Palette) => void;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  toggleRightPanel: () => void;
  setRightPanelTab: (tab: UIState['rightPanelTab']) => void;
  setFeature: (key: keyof FeatureFlags, value: boolean) => void;
  openSettings: () => void;
  closeSettings: () => void;
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
      rightPanelCollapsed: true,
      rightPanelTab: 'backlinks',
      features: DEFAULT_FEATURES,
      settingsOpen: false,

      setTheme: (theme) => set({ theme }),
      setPalette: (palette) => set({ palette }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarWidth: (width) => set({ sidebarWidth: clampSidebarWidth(width) }),
      toggleRightPanel: () => set((s) => ({ rightPanelCollapsed: !s.rightPanelCollapsed })),
      setRightPanelTab: (tab) => set({ rightPanelTab: tab }),
      setFeature: (key, value) =>
        set((s) => ({ features: { ...s.features, [key]: value } })),
      openSettings: () => set({ settingsOpen: true }),
      closeSettings: () => set({ settingsOpen: false }),
    }),
    {
      name: 'mycel-ui',
      partialize: (s) => ({
        sidebarWidth: s.sidebarWidth,
        theme: s.theme,
        palette: s.palette,
        features: s.features,
      }),
    },
  ),
);
