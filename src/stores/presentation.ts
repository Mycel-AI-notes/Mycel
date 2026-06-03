import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { splitSlides, type Slide } from '@/lib/presentation/splitSlides';

export const FONT_SCALE_MIN = 0.6;
export const FONT_SCALE_MAX = 1.8;
export const FONT_SCALE_STEP = 0.1;

const clampScale = (n: number) =>
  Math.min(FONT_SCALE_MAX, Math.max(FONT_SCALE_MIN, Math.round(n * 10) / 10));

const clampIndex = (i: number, len: number) =>
  Math.min(len - 1, Math.max(0, i));

interface PresentationState {
  open: boolean;
  slides: Slide[];
  current: number; // 0-based
  overview: boolean; // grid overview open
  fontScale: number; // 1.0 default, step 0.1, range 0.6..1.8 — persisted
  sourcePath?: string;

  start(markdown: string, sourcePath?: string): void;
  close(): void;
  next(): void;
  prev(): void;
  goto(i: number): void;
  toggleOverview(): void;
  setFontScale(n: number): void;
}

export const usePresentationStore = create<PresentationState>()(
  persist(
    (set) => ({
      open: false,
      slides: [],
      current: 0,
      overview: false,
      fontScale: 1.0,
      sourcePath: undefined,

      start: (markdown, sourcePath) =>
        set({
          open: true,
          slides: splitSlides(markdown),
          current: 0,
          overview: false,
          sourcePath,
        }),

      close: () => set({ open: false, overview: false }),

      next: () =>
        set((s) => ({ current: clampIndex(s.current + 1, s.slides.length) })),

      prev: () =>
        set((s) => ({ current: clampIndex(s.current - 1, s.slides.length) })),

      goto: (i) =>
        set((s) => ({ current: clampIndex(i, s.slides.length) })),

      toggleOverview: () => set((s) => ({ overview: !s.overview })),

      setFontScale: (n) => set({ fontScale: clampScale(n) }),
    }),
    {
      name: 'mycel-presentation',
      // Only the font scale survives across sessions — slides, open state and
      // the current index are ephemeral and rebuilt from the live buffer.
      partialize: (s) => ({ fontScale: s.fontScale }),
    },
  ),
);

/** Convenience used by the store's keyboard-free callers (slash command,
 *  global shortcut) — kept here so `get()` stays internal. */
export function presentMarkdown(markdown: string, sourcePath?: string) {
  usePresentationStore.getState().start(markdown, sourcePath);
}
