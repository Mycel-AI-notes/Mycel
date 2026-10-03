import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { HotkeyOverrides } from '@/lib/commands';
import { DEFAULT_TEMPLATES_FOLDER } from '@/lib/templates';
import { DEFAULT_DAILY_FOLDER } from '@/lib/daily-notes';

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

/** Note column width (rem) when readable line width is on. */
export const READABLE_WIDTH_MIN = 32;
export const READABLE_WIDTH_MAX = 96;
export const READABLE_WIDTH_DEFAULT = 46;
export const READABLE_WIDTH_STEP = 4;

/// Opt-in / opt-out switches for whole features. Persists across sessions
/// so a user who hides Garden never has to deal with it again.
export interface FeatureFlags {
  garden: boolean;
  /** Living motion: drifting spores, hyphae growing, notes and folders
   *  germinating into the Mycel mark. */
  sporeMotion: boolean;
  /** Keep note text in a centred column of comfortable line length. */
  readableWidth: boolean;
}

const DEFAULT_FEATURES: FeatureFlags = {
  garden: true,
  sporeMotion: true,
  readableWidth: true,
};

interface UIState {
  theme: Theme;
  palette: Palette;
  sidebarCollapsed: boolean;
  sidebarWidth: number;
  /** Width of the note column (rem) under readable line width. */
  readableWidth: number;
  rightPanelCollapsed: boolean;
  rightPanelTab: 'backlinks' | 'outline' | 'tags';
  features: FeatureFlags;
  settingsOpen: boolean;
  /** Transient overlays. Live in the store rather than `App` state so a
   *  command (see `lib/app-commands.ts`) can open them from anywhere. */
  paletteOpen: boolean;
  quickSwitcherOpen: boolean;
  graphOpen: boolean;
  /** Focus mode: all chrome hidden, only the text — and the paragraph
   *  being written — stays lit. Session-only on purpose. */
  focusMode: boolean;
  /** User hotkey rebinds by command id; `null` is an explicit unbind. Only
   *  differences from the defaults are stored, so a default changed in a
   *  later release still reaches users who never touched that command. */
  hotkeyOverrides: HotkeyOverrides;
  /** Vault-relative folder whose `.md` files are offered as templates. */
  templatesFolder: string;
  templatePickerOpen: boolean;
  /** Vault-relative folder holding `YYYY-MM-DD.md` daily notes. */
  dailyFolder: string;
  /** Template path for new daily notes; empty means "a template named
   *  `daily` in the templates folder, if there is one". */
  dailyTemplate: string;

  setTheme: (theme: Theme) => void;
  setPalette: (palette: Palette) => void;
  toggleSidebar: () => void;
  setSidebarWidth: (width: number) => void;
  setReadableWidth: (rem: number) => void;
  toggleRightPanel: () => void;
  setRightPanelTab: (tab: UIState['rightPanelTab']) => void;
  setFeature: (key: keyof FeatureFlags, value: boolean) => void;
  openSettings: () => void;
  closeSettings: () => void;
  setPaletteOpen: (open: boolean) => void;
  setQuickSwitcherOpen: (open: boolean) => void;
  setGraphOpen: (open: boolean) => void;
  toggleFocusMode: () => void;
  setHotkeyOverride: (commandId: string, hotkey: string | null) => void;
  resetHotkey: (commandId: string) => void;
  setTemplatesFolder: (folder: string) => void;
  setTemplatePickerOpen: (open: boolean) => void;
  setDailyFolder: (folder: string) => void;
  setDailyTemplate: (path: string) => void;
}

const clampReadableWidth = (rem: number) =>
  Math.min(READABLE_WIDTH_MAX, Math.max(READABLE_WIDTH_MIN, Math.round(rem)));

const clampSidebarWidth = (w: number) =>
  Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, Math.round(w)));

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      theme: 'dark',
      palette: 'moss',
      sidebarCollapsed: false,
      sidebarWidth: SIDEBAR_DEFAULT_WIDTH,
      readableWidth: READABLE_WIDTH_DEFAULT,
      rightPanelCollapsed: true,
      rightPanelTab: 'backlinks',
      features: DEFAULT_FEATURES,
      settingsOpen: false,
      paletteOpen: false,
      quickSwitcherOpen: false,
      graphOpen: false,
      focusMode: false,
      hotkeyOverrides: {},
      templatesFolder: DEFAULT_TEMPLATES_FOLDER,
      templatePickerOpen: false,
      dailyFolder: DEFAULT_DAILY_FOLDER,
      dailyTemplate: '',

      setTheme: (theme) => set({ theme }),
      setPalette: (palette) => set({ palette }),
      toggleSidebar: () => set((s) => ({ sidebarCollapsed: !s.sidebarCollapsed })),
      setSidebarWidth: (width) => set({ sidebarWidth: clampSidebarWidth(width) }),
      setReadableWidth: (rem) => set({ readableWidth: clampReadableWidth(rem) }),
      toggleRightPanel: () => set((s) => ({ rightPanelCollapsed: !s.rightPanelCollapsed })),
      setRightPanelTab: (tab) => set({ rightPanelTab: tab }),
      setFeature: (key, value) =>
        set((s) => ({ features: { ...s.features, [key]: value } })),
      openSettings: () => set({ settingsOpen: true }),
      closeSettings: () => set({ settingsOpen: false }),
      setPaletteOpen: (open) => set({ paletteOpen: open }),
      setQuickSwitcherOpen: (open) => set({ quickSwitcherOpen: open }),
      setGraphOpen: (open) => set({ graphOpen: open }),
      toggleFocusMode: () => set((s) => ({ focusMode: !s.focusMode })),
      setHotkeyOverride: (commandId, hotkey) =>
        set((s) => ({ hotkeyOverrides: { ...s.hotkeyOverrides, [commandId]: hotkey } })),
      setTemplatesFolder: (folder) => set({ templatesFolder: folder }),
      setTemplatePickerOpen: (open) => set({ templatePickerOpen: open }),
      setDailyFolder: (folder) => set({ dailyFolder: folder }),
      setDailyTemplate: (path) => set({ dailyTemplate: path }),
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
        readableWidth: s.readableWidth,
        theme: s.theme,
        palette: s.palette,
        features: s.features,
        hotkeyOverrides: s.hotkeyOverrides,
        templatesFolder: s.templatesFolder,
        dailyFolder: s.dailyFolder,
        dailyTemplate: s.dailyTemplate,
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
