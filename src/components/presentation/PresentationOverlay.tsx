import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ChevronLeft,
  ChevronRight,
  AArrowDown,
  AArrowUp,
  LayoutGrid,
  Maximize2,
  Pencil,
  Keyboard,
  X,
} from 'lucide-react';
import {
  usePresentationStore,
  FONT_SCALE_STEP,
} from '@/stores/presentation';
import { useVaultStore } from '@/stores/vault';
import { getEditorView, scrollEditorToLine } from '@/lib/editor-registry';
import { SlideView } from './SlideView';
import { SlideOverview } from './SlideOverview';

const HIDE_DELAY_MS = 2500;

const SHORTCUTS: [string, string][] = [
  ['→  Space  PageDn', 'Next slide'],
  ['←  PageUp', 'Previous slide'],
  ['O  /  G', 'Toggle overview'],
  ['E', 'Edit this slide'],
  ['F', 'Toggle fullscreen'],
  ['A−  /  A+', 'Smaller / larger text'],
  ['?  /  H', 'Toggle this help'],
  ['Esc', 'Close help / overview, or exit'],
];

/** Toggle the OS window fullscreen when running under Tauri. No-op (and
 *  silent) under a plain Vite dev server where the Tauri API is absent. */
async function setWindowFullscreen(on: boolean) {
  try {
    const { getCurrentWindow } = await import('@tauri-apps/api/window');
    await getCurrentWindow().setFullscreen(on);
  } catch {
    /* not running under Tauri — ignore */
  }
}

export function PresentationOverlay() {
  const open = usePresentationStore((s) => s.open);
  const slides = usePresentationStore((s) => s.slides);
  const current = usePresentationStore((s) => s.current);
  const overview = usePresentationStore((s) => s.overview);
  const fontScale = usePresentationStore((s) => s.fontScale);
  const next = usePresentationStore((s) => s.next);
  const prev = usePresentationStore((s) => s.prev);
  const close = usePresentationStore((s) => s.close);
  const toggleOverview = usePresentationStore((s) => s.toggleOverview);
  const setFontScale = usePresentationStore((s) => s.setFontScale);

  const [controlsVisible, setControlsVisible] = useState(true);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [helpVisible, setHelpVisible] = useState(false);
  const helpRef = useRef(false);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slideRef = useRef<HTMLDivElement>(null);

  const setHelp = useCallback((v: boolean | ((p: boolean) => boolean)) => {
    setHelpVisible((prev) => {
      const nv = typeof v === 'function' ? v(prev) : v;
      helpRef.current = nv;
      return nv;
    });
  }, []);

  const revealControls = useCallback(() => {
    setControlsVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setControlsVisible(false), HIDE_DELAY_MS);
  }, []);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((on) => {
      void setWindowFullscreen(!on);
      return !on;
    });
  }, []);

  /** Leave the show and drop the editor caret on the current slide's source
   *  line, so the user edits exactly the part they were looking at. */
  const editCurrentSlide = useCallback(() => {
    const { sourcePath, slides: sl, current: cur } = usePresentationStore.getState();
    const line = sl[cur]?.line ?? 0;
    close();
    if (!sourcePath) return;
    void useVaultStore
      .getState()
      .openNote(sourcePath)
      .then(() => {
        // The editor may need a frame to mount and register its view.
        let tries = 0;
        const tryScroll = () => {
          if (getEditorView(sourcePath) || tries > 20) {
            scrollEditorToLine(sourcePath, line);
            return;
          }
          tries++;
          requestAnimationFrame(tryScroll);
        };
        tryScroll();
      });
  }, [close]);

  // Reset scroll to the top whenever the slide changes.
  useEffect(() => {
    slideRef.current?.scrollTo({ top: 0 });
  }, [current]);

  // Keyboard controls. Bound only while presenting.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const { overview: ov } = usePresentationStore.getState();
      switch (e.key) {
        case 'ArrowRight':
        case ' ':
        case 'PageDown':
          e.preventDefault();
          if (!ov) next();
          break;
        case 'ArrowLeft':
        case 'PageUp':
          e.preventDefault();
          if (!ov) prev();
          break;
        case 'o':
        case 'O':
        case 'g':
        case 'G':
          e.preventDefault();
          toggleOverview();
          break;
        case 'e':
        case 'E':
          e.preventDefault();
          editCurrentSlide();
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          toggleFullscreen();
          break;
        case '?':
        case 'h':
        case 'H':
          e.preventDefault();
          setHelp((v) => !v);
          break;
        case 'Escape':
          e.preventDefault();
          if (helpRef.current) setHelp(false);
          else if (ov) toggleOverview();
          else close();
          break;
        default:
          return;
      }
      revealControls();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, slides.length, next, prev, close, toggleOverview, toggleFullscreen, editCurrentSlide, setHelp, revealControls]);

  // Start the auto-hide cycle when the overlay opens; reset transient UI and
  // drop fullscreen on close.
  useEffect(() => {
    if (open) {
      revealControls();
    } else {
      if (hideTimer.current) clearTimeout(hideTimer.current);
      setControlsVisible(true);
      setHelp(false);
      if (isFullscreen) {
        void setWindowFullscreen(false);
        setIsFullscreen(false);
      }
    }
    return () => {
      if (hideTimer.current) clearTimeout(hideTimer.current);
    };
  }, [open, revealControls]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!open) return null;

  const slide = slides[current];
  const total = slides.length;
  const progress = total > 0 ? ((current + 1) / total) * 100 : 0;

  const overlay = (
    <div
      className="fixed inset-0 z-[1000] bg-surface-1 text-text-primary"
      style={{ height: '100vh', width: '100vw' }}
      onMouseMove={revealControls}
    >
      {/* Slide content. The padding area around the card carries
          `data-tauri-drag-region` so the user can grab the empty space to
          move the window — the overlay otherwise hides the title bar. The
          card itself isn't a drag region, so its text stays selectable,
          scrollable, and its links stay clickable. */}
      <div ref={slideRef} className="absolute inset-0 overflow-y-auto">
        <div
          data-tauri-drag-region
          className="min-h-full flex flex-col items-center justify-center px-6 sm:px-12 py-16"
        >
          <div
            className="w-full rounded-2xl border border-border bg-surface-0 shadow-lg px-8 sm:px-14 py-10 sm:py-12"
            style={{ maxWidth: '1040px' }}
          >
            {slide && (
              <SlideView key={current} slide={slide} fontScale={fontScale} />
            )}
          </div>
        </div>
      </div>

      {/* Overview grid (renders above the slide) */}
      {overview && <SlideOverview />}

      {/* Chevrons */}
      <button
        onClick={prev}
        disabled={current === 0}
        className={`absolute left-4 top-1/2 -translate-y-1/2 p-2 rounded-full text-text-muted hover:text-text-primary hover:bg-surface-hover transition-opacity disabled:opacity-20 ${
          controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        title="Previous slide (←)"
      >
        <ChevronLeft size={32} />
      </button>
      <button
        onClick={next}
        disabled={current >= total - 1}
        className={`absolute right-4 top-1/2 -translate-y-1/2 p-2 rounded-full text-text-muted hover:text-text-primary hover:bg-surface-hover transition-opacity disabled:opacity-20 ${
          controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        title="Next slide (→)"
      >
        <ChevronRight size={32} />
      </button>

      {/* Hotkeys help */}
      {helpVisible && (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center bg-surface-1/70 backdrop-blur-sm"
          onClick={() => setHelp(false)}
        >
          <div
            className="rounded-xl border border-border bg-surface-0 shadow-lg p-6 min-w-[320px]"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 mb-4 text-text-primary">
              <Keyboard size={16} />
              <span className="text-sm font-semibold">Keyboard shortcuts</span>
            </div>
            <dl className="space-y-1.5">
              {SHORTCUTS.map(([keys, label]) => (
                <div key={keys} className="flex items-center justify-between gap-8 text-xs">
                  <dt className="text-text-muted">{label}</dt>
                  <dd>
                    <kbd className="font-mono bg-surface-2 text-text-secondary px-1.5 py-0.5 rounded">
                      {keys}
                    </kbd>
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      )}

      {/* Bottom bar */}
      <div
        className={`absolute bottom-0 inset-x-0 transition-opacity ${
          controlsVisible ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center gap-2 px-4 py-2 text-text-muted text-xs">
          <button
            onClick={() => setFontScale(fontScale - FONT_SCALE_STEP)}
            className="p-1.5 rounded hover:bg-surface-hover hover:text-text-primary transition-colors"
            title="Smaller text (A−)"
          >
            <AArrowDown size={16} />
          </button>
          <button
            onClick={() => setFontScale(fontScale + FONT_SCALE_STEP)}
            className="p-1.5 rounded hover:bg-surface-hover hover:text-text-primary transition-colors"
            title="Larger text (A+)"
          >
            <AArrowUp size={16} />
          </button>

          <span className="flex-1 text-center font-mono tabular-nums">
            {current + 1} / {total}
          </span>

          <button
            onClick={editCurrentSlide}
            className="p-1.5 rounded hover:bg-surface-hover hover:text-text-primary transition-colors"
            title="Edit this slide (E)"
          >
            <Pencil size={16} />
          </button>
          <button
            onClick={() => setHelp((v) => !v)}
            className={`p-1.5 rounded hover:bg-surface-hover hover:text-text-primary transition-colors ${
              helpVisible ? 'text-accent' : ''
            }`}
            title="Keyboard shortcuts (?)"
          >
            <Keyboard size={16} />
          </button>
          <button
            onClick={toggleOverview}
            className={`p-1.5 rounded hover:bg-surface-hover hover:text-text-primary transition-colors ${
              overview ? 'text-accent' : ''
            }`}
            title="Overview (O)"
          >
            <LayoutGrid size={16} />
          </button>
          <button
            onClick={toggleFullscreen}
            className="p-1.5 rounded hover:bg-surface-hover hover:text-text-primary transition-colors"
            title="Fullscreen (F)"
          >
            <Maximize2 size={16} />
          </button>
          <button
            onClick={close}
            className="p-1.5 rounded hover:bg-surface-hover hover:text-text-primary transition-colors"
            title="Exit presentation (Esc)"
          >
            <X size={16} />
          </button>
        </div>
        {/* Progress bar */}
        <div className="h-0.5 w-full bg-surface-2">
          <div
            className="h-full bg-accent transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
    </div>
  );

  return createPortal(overlay, document.body);
}
