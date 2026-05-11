import { X, Inbox, Zap, ClipboardList, Hourglass, Lightbulb, RefreshCw, Sprout } from 'lucide-react';

interface Props {
  onClose: () => void;
}

export function GardenHelp({ onClose }: Props) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl mx-4 max-h-[85vh] overflow-y-auto bg-surface-1 border border-border rounded-lg shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-3 border-b border-border bg-surface-0">
          <h2 className="text-text-primary text-sm font-semibold inline-flex items-center gap-2">
            <Sprout size={14} className="text-accent" />
            How Garden works
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded text-text-muted hover:bg-surface-hover hover:text-text-primary"
          >
            <X size={16} />
          </button>
        </header>

        <div className="p-5 text-sm text-text-secondary flex flex-col gap-4">
          <p>
            <b className="text-text-primary">Anything that takes up your attention → Inbox → process → concrete action.</b>{' '}
            Your head is for thinking, not for storing.
          </p>

          <section>
            <h3 className="text-text-primary font-semibold mb-2">The five lists</h3>
            <ul className="flex flex-col gap-2">
              <li className="flex items-start gap-2">
                <Inbox size={14} className="text-accent mt-1 shrink-0" />
                <div>
                  <b className="text-text-primary">Inbox</b> — capture any thought instantly.
                  Press <kbd className="bg-surface-2 px-1 rounded text-[11px]">⌘I</kbd> from anywhere.
                  Don't think — just write. Process later.
                </div>
              </li>
              <li className="flex items-start gap-2">
                <Zap size={14} className="text-accent mt-1 shrink-0" />
                <div>
                  <b className="text-text-primary">Next Actions</b> — concrete physical actions
                  grouped by context (<i>@computer, @call, @home</i>). Open this when you
                  want to <i>do</i> something. Pick by what's possible now, not what's most important.
                </div>
              </li>
              <li className="flex items-start gap-2">
                <ClipboardList size={14} className="text-accent-deep mt-1 shrink-0" />
                <div>
                  <b className="text-text-primary">Projects</b> — outcomes that need more
                  than one step. Every active project must have at least one next action —
                  a project without a next action is a dead project.
                </div>
              </li>
              <li className="flex items-start gap-2">
                <Hourglass size={14} className="text-text-muted mt-1 shrink-0" />
                <div>
                  <b className="text-text-primary">Waiting For</b> — anything you've
                  delegated or are blocked on. Don't keep these in your head.
                </div>
              </li>
              <li className="flex items-start gap-2">
                <Lightbulb size={14} className="text-text-muted mt-1 shrink-0" />
                <div>
                  <b className="text-text-primary">Someday / Maybe</b> — ideas, dreams,
                  "would be cool". No pressure, no deadlines. Review weekly to see what's ripe.
                </div>
              </li>
            </ul>
          </section>

          <section>
            <h3 className="text-text-primary font-semibold mb-2">Daily flow</h3>
            <ol className="list-decimal pl-5 flex flex-col gap-1">
              <li>Morning: open Next Actions, pick 1–3 focuses for the day.</li>
              <li>Throughout the day: thoughts → <kbd className="bg-surface-2 px-1 rounded text-[11px]">⌘I</kbd> → Inbox.</li>
              <li>Evening (optional): process the inbox down to zero.</li>
            </ol>
          </section>

          <section>
            <h3 className="text-text-primary font-semibold mb-2 flex items-center gap-2">
              <RefreshCw size={13} className="text-accent" /> Weekly Review
            </h3>
            <p>
              Once a week, run the 6-step wizard from Projects → Weekly Review.
              15–30 minutes and your head is clear:
            </p>
            <ol className="list-decimal pl-5 flex flex-col gap-1 mt-1">
              <li>Clear inbox</li>
              <li>Skim next actions — still relevant?</li>
              <li>Waiting For — time to follow up?</li>
              <li>Projects — every active one has a next action?</li>
              <li>Someday — anything ripe to activate?</li>
              <li>Brain dump — capture whatever else is rattling around.</li>
            </ol>
          </section>

          <section>
            <h3 className="text-text-primary font-semibold mb-2">Shortcuts</h3>
            <ul className="flex flex-col gap-1 text-xs">
              <li>
                <kbd className="bg-surface-2 px-1 rounded">⌘I</kbd> — quick capture (works from any screen)
              </li>
              <li>
                <kbd className="bg-surface-2 px-1 rounded">⌘⇧A</kbd> — open Next Actions
              </li>
              <li>
                <kbd className="bg-surface-2 px-1 rounded">⌘⇧P</kbd> — open Projects
              </li>
              <li>
                <kbd className="bg-surface-2 px-1 rounded">⌘`</kbd> — toggle the Garden section in the sidebar
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  );
}
