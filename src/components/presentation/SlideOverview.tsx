import { usePresentationStore } from '@/stores/presentation';

/**
 * Table-of-contents grid. Each card shows the slide title plus a short text
 * preview (first few non-empty lines). The current slide is highlighted;
 * clicking a card jumps to it and closes the overview.
 */

function previewOf(md: string): string {
  const lines = md
    .split('\n')
    .map((l) => l.trim())
    // drop the heading line (already shown as the title) and fences/markers
    .filter((l) => l && !/^#{1,6}\s/.test(l) && !/^(`{3,}|~{3,})/.test(l));
  return lines.slice(0, 3).join(' ').slice(0, 140);
}

export function SlideOverview() {
  const slides = usePresentationStore((s) => s.slides);
  const current = usePresentationStore((s) => s.current);
  const goto = usePresentationStore((s) => s.goto);
  const toggleOverview = usePresentationStore((s) => s.toggleOverview);

  return (
    <div className="absolute inset-0 z-10 overflow-y-auto bg-surface-1/95 backdrop-blur-sm p-8">
      <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4 max-w-6xl mx-auto">
        {slides.map((slide) => {
          const active = slide.index === current;
          return (
            <button
              key={slide.index}
              onClick={() => {
                goto(slide.index);
                toggleOverview();
              }}
              className={`text-left rounded-lg border p-4 h-40 overflow-hidden transition-colors ${
                active
                  ? 'border-accent bg-surface-2 ring-1 ring-accent'
                  : 'border-border bg-surface-0 hover:bg-surface-hover'
              }`}
            >
              <div className="flex items-baseline gap-2 mb-2">
                <span className="text-xs text-text-muted font-mono shrink-0">
                  {slide.index + 1}
                </span>
                <span className="text-sm font-semibold text-text-primary truncate">
                  {slide.title}
                </span>
              </div>
              <p className="text-xs text-text-muted leading-relaxed line-clamp-4">
                {previewOf(slide.md)}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}
