import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { HotkeyOverrides } from '@/lib/commands';

type Theme = 'light' | 'dark' | 'system';

export type Palette = 'moss' | 'amber' | 'azure' | 'plum' | 'coral' | 'sage' | 'classic';

export const PALETTES: { id: Palette; label: string; swatch: string }[] = [
  { id: 'moss',    label: 'Moss',          swatch: '#C8F52A' },
  { id: 'plum',    label: 'Plum',          swatch: '#B292FF' },
  { id: 'coral',   label: 'Coral',         swatch: '#FF7E6B' },
  { id: 'amber',   label: 'Amber (Light)', swatch: '#E48A1A' },
  { id: 'azure',   label: 'Azure (Light)', swatch: '#3A82E2' },
  { id: 'sage',    label: 'Sage (Light)',  swatch: '#6B8A52' },
  { id: 'classic', label: 'Classic',       swatch: '#ffffff' },
];

export const SIDEBAR_MIN_WIDTH = 160;
export const SIDEBAR_MAX_WIDTH = 600;
export const SIDEBAR_DEFAULT_WIDTH = 224;

/// Opt-in / opt-out switches for whole features. Persists across sessions
/// so a user who hides Garden never has to deal with it again.
export interface FeatureFlags {
  garden: boolean;
  /** Living motion: drifting spores, hyphae growing, notes and folders
   *  germinating into the Mycel mark. */
  sporeMotion: boolean;
}

const DEFAULT_FEATURES: FeatureFlags = {
  garden: true,
  sporeMotion: true,
};

interface UIState {
  theme: Theme;
  palette: Palette;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  rightPanelCollapsed: boolean;
  rightPanelTab: 'backlinks' | 'outline' | 'tags';
  features: FeatureFlags;
  settingsOpen: boolean;
  /** Transient overlays. Live in the store rather than `App` state so a
   *  command (see `lib/app-commands.ts`) can open them from anywhere. */
  paletteOpen: boolean;
  quickSwitcherOpen: boolean;
  graphOpen: boolean;
  /** User hotkey rebinds by command id; `null` is an explicit unbind. Only
   *  differences from the defaults are stored, so a default changed in a
   *  later release still reaches users who never touched that command. */
  hotkeyOverrides: HotkeyOverrides;

  setTheme: (theme: Theme) => void;
  setPalette: (palette: Palette) => void;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  toggleRightPanel: () => void;
  setRightPanelTab: (tab: UIState['rightPanelTab']) => void;
  setFeature: (key: keyof FeatureFlags, value: boolean) => void;
  openSettings: () => void;
  closeSettings: () => void;
  setPaletteOpen: (open: boolean) => void;
  setQuickSwitcherOpen: (open: boolean) => void;
  setGraphOpen: (open: boolean) => void;
  setHotkeyOverride: (commandId: string, hotkey: string | null) => void;
  resetHotkey: (commandId: string) => void;
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
      paletteOpen: false,
      quickSwitcherOpen: false,
      graphOpen: false,
      hotkeyOverrides: {},

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
      setPaletteOpen: (open) => set({ paletteOpen: open }),
      setQuickSwitcherOpen: (open) => set({ quickSwitcherOpen: open }),
      setGraphOpen: (open) => set({ graphOpen: open }),
      setHotkeyOverride: (commandId, hotkey) =>
        set((s) => ({ hotkeyOverrides: { ...s.hotkeyOverrides, [commandId]: hotkey } })),
      resetHotkey: (commandId) =>
        set((s) => {
          const next = { ...s.hotkeyOverrides };
          delete next[commandId];
          return { hotkeyOverrides: next };
        }),
    }),
    {
      name: 'mycel-ui',
      partialize: (s) => ({
        sidebarWidth: s.sidebarWidth,
        theme: s.theme,
        palette: s.palette,
        features: s.features,
        hotkeyOverrides: s.hotkeyOverrides,
      }),
      // Deep-merge feature flags so a flag added after the user's state was
      // saved picks up its default instead of reading as `undefined`.
      merge: (persisted, current) => {
        const p = (persisted ?? {}) as Partial<UIState>;
        return {
          ...current,
          ...p,
          features: { ...DEFAULT_FEATURES, ...(p.features ?? {}) },
        };
      },
    },
  ),
);
