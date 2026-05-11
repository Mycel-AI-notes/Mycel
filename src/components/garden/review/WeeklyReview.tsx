import { useEffect, useMemo, useState } from 'react';
import {
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Inbox,
  Zap,
  Hourglass,
  ClipboardList,
  Lightbulb,
  Plus,
} from 'lucide-react';
import { useGardenStore } from '@/stores/garden';
import { useVaultStore } from '@/stores/vault';
import { ProcessDropdown } from '../inbox/ProcessDropdown';

const STEPS = [
  { id: 1, name: 'Clear Inbox', icon: Inbox },
  { id: 2, name: 'Review Next Actions', icon: Zap },
  { id: 3, name: 'Review Waiting For', icon: Hourglass },
  { id: 4, name: 'Review Projects', icon: ClipboardList },
  { id: 5, name: 'Review Someday', icon: Lightbulb },
  { id: 6, name: 'Brain Dump', icon: Plus },
] as const;

export function WeeklyReview() {
  const openGardenTab = useVaultStore((s) => s.openGardenTab);
  const refreshAll = useGardenStore((s) => s.refreshAll);
  const inbox = useGardenStore((s) => s.inbox);
  const actions = useGardenStore((s) => s.actions);
  const waiting = useGardenStore((s) => s.waiting);
  const projects = useGardenStore((s) => s.projects);
  const someday = useGardenStore((s) => s.someday);
  const completeAction = useGardenStore((s) => s.completeAction);
  const completeWaiting = useGardenStore((s) => s.completeWaiting);
  const updateProject = useGardenStore((s) => s.updateProject);
  const capture = useGardenStore((s) => s.capture);
  const addProject = useGardenStore((s) => s.addProject);
  const deleteSomeday = useGardenStore((s) => s.deleteSomeday);
  const config = useGardenStore((s) => s.config);

  const [step, setStep] = useState(1);
  const [brainDump, setBrainDump] = useState('');
  const [done, setDone] = useState(false);

  // Stats snapshot taken when the wizard starts.
  const [snapshot] = useState(() => ({
    inbox: inbox.length,
    actions_open: actions.filter((a) => !a.done).length,
    projects_active: projects.filter((p) => p.status === 'active').length,
    someday: someday.length,
  }));

  useEffect(() => {
    void refreshAll();
  }, [refreshAll]);

  const next = () => setStep((s) => Math.min(STEPS.length, s + 1));
  const prev = () => setStep((s) => Math.max(1, s - 1));

  const finish = () => {
    setDone(true);
  };

  const liveActions = useMemo(() => actions.filter((a) => !a.done), [actions]);
  const liveWaiting = useMemo(() => waiting.filter((w) => !w.done), [waiting]);
  const activeProjects = useMemo(
    () => projects.filter((p) => p.status === 'active'),
    [projects],
  );
  const projectsWithoutActions = useMemo(
    () =>
      activeProjects.filter(
        (p) => !actions.some((a) => a.project === p.title && !a.done),
      ),
    [activeProjects, actions],
  );

  const submitBrainDump = async () => {
    const lines = brainDump
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);
    for (const l of lines) {
      // eslint-disable-next-line no-await-in-loop -- order matters; cheap operation
      await capture(l);
    }
    setBrainDump('');
  };

  if (done) {
    const finalCounts = {
      inbox: inbox.length,
      actions_open: actions.filter((a) => !a.done).length,
      projects_active: projects.filter((p) => p.status === 'active').length,
      someday: someday.length,
    };
    return (
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-xl mx-auto text-center">
          <div className="text-4xl mb-4">✅</div>
          <h1 className="text-xl text-text-primary mb-1">Weekly Review Complete</h1>
          <p className="text-text-muted text-sm mb-6">
            {new Date().toLocaleDateString()}
          </p>
          <div className="text-sm text-text-secondary text-left bg-surface-1 border border-border rounded-md p-4 flex flex-col gap-1">
            <div>📥 Inbox: {snapshot.inbox} → {finalCounts.inbox}</div>
            <div>⚡ Open actions: {snapshot.actions_open} → {finalCounts.actions_open}</div>
            <div>📋 Active projects: {snapshot.projects_active} → {finalCounts.projects_active}</div>
            <div>💭 Someday: {snapshot.someday} → {finalCounts.someday}</div>
          </div>
          <button
            onClick={() => openGardenTab({ kind: 'actions' }, { preview: false })}
            className="mt-6 px-4 py-2 rounded bg-accent/15 text-accent hover:bg-accent/25 text-sm"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  const stepDef = STEPS[step - 1];
  const StepIcon = stepDef.icon;

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-6">
          <h1 className="flex items-center gap-2 text-xl text-text-primary">
            <RefreshCw size={20} className="text-accent" /> Weekly Review
          </h1>
          <span className="text-text-muted text-sm">Step {step} / {STEPS.length}</span>
        </div>

        <div className="border-b border-border pb-2 mb-4 flex items-center gap-2 text-sm text-text-secondary">
          <StepIcon size={16} className="text-accent" />
          <span>{stepDef.name}</span>
        </div>

        {step === 1 && (
          <div>
            {inbox.length === 0 ? (
              <p className="text-text-muted text-sm py-6">Inbox is clear. Onwards.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {inbox.map((item) => (
                  <li
                    key={item.id}
                    className="border border-border rounded-md bg-surface-1 p-3 flex items-start gap-3"
                  >
                    <div className="flex-1 text-sm">{item.text}</div>
                    <ProcessDropdown item={item} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {step === 2 && (
          <div>
            <p className="text-text-muted text-sm mb-2">
              Skim the list. Mark anything that's no longer relevant as done.
            </p>
            <ul className="flex flex-col">
              {liveActions.map((a) => (
                <li key={a.id} className="flex items-center gap-2 py-1 text-sm">
                  <button
                    onClick={() => completeAction(a.id, true)}
                    className="w-4 h-4 rounded-full border border-text-muted hover:border-accent"
                  />
                  <span className="flex-1">{a.action}</span>
                  <span className="text-[11px] text-text-muted">
                    {a.context} {a.project ? `· ${a.project}` : ''}
                  </span>
                </li>
              ))}
              {liveActions.length === 0 && (
                <p className="text-text-muted text-sm py-6">Nothing to review.</p>
              )}
            </ul>
          </div>
        )}

        {step === 3 && (
          <div>
            <p className="text-text-muted text-sm mb-2">
              Anything to follow up on? Mark received items done.
            </p>
            <ul className="flex flex-col">
              {liveWaiting.map((w) => (
                <li key={w.id} className="flex items-center gap-2 py-1 text-sm">
                  <button
                    onClick={() => completeWaiting(w.id, true)}
                    className="w-4 h-4 rounded-full border border-text-muted hover:border-accent"
                  />
                  <span className="flex-1">{w.what}</span>
                  <span className="text-[11px] text-text-muted">
                    from {w.from} · since {w.since}
                  </span>
                </li>
              ))}
              {liveWaiting.length === 0 && (
                <p className="text-text-muted text-sm py-6">Not waiting on anything.</p>
              )}
            </ul>
          </div>
        )}

        {step === 4 && (
          <div>
            <p className="text-text-muted text-sm mb-2">
              Each active project should have at least one next action.
              {projectsWithoutActions.length > 0 && (
                <span className="text-error ml-1">
                  {projectsWithoutActions.length} project
                  {projectsWithoutActions.length === 1 ? '' : 's'} need attention.
                </span>
              )}
            </p>
            <ul className="flex flex-col gap-1">
              {activeProjects.map((p) => {
                const hasAction = actions.some(
                  (a) => a.project === p.title && !a.done,
                );
                return (
                  <li
                    key={p.id}
                    className="flex items-center gap-2 py-1 text-sm border-b border-border"
                  >
                    <span className="flex-1">{p.title}</span>
                    {!hasAction && (
                      <span className="text-[11px] text-error">no next action</span>
                    )}
                    <button
                      onClick={() => updateProject(p.id, { status: 'paused' })}
                      className="text-[11px] px-1 py-0.5 rounded border border-border text-text-muted hover:bg-surface-hover"
                    >
                      pause
                    </button>
                    <button
                      onClick={() => updateProject(p.id, { status: 'done' })}
                      className="text-[11px] px-1 py-0.5 rounded border border-border text-text-muted hover:bg-surface-hover"
                    >
                      done
                    </button>
                  </li>
                );
              })}
              {activeProjects.length === 0 && (
                <p className="text-text-muted text-sm py-6">No active projects.</p>
              )}
            </ul>
          </div>
        )}

        {step === 5 && (
          <div>
            <p className="text-text-muted text-sm mb-2">
              Anything ready to graduate to a project?
            </p>
            <ul className="flex flex-col gap-1">
              {someday.map((s) => (
                <li
                  key={s.id}
                  className="flex items-center gap-2 py-1 text-sm border-b border-border"
                >
                  <span className="flex-1">💭 {s.text}</span>
                  <button
                    onClick={async () => {
                      await addProject({ title: s.text });
                      await deleteSomeday(s.id);
                    }}
                    className="text-[11px] px-1 py-0.5 rounded border border-border text-accent hover:bg-accent/10"
                  >
                    → Project
                  </button>
                </li>
              ))}
              {someday.length === 0 && (
                <p className="text-text-muted text-sm py-6">No someday items.</p>
              )}
            </ul>
          </div>
        )}

        {step === 6 && (
          <div className="flex flex-col gap-2">
            <p className="text-text-muted text-sm">
              What else is rattling around? One per line — each becomes an inbox item.
            </p>
            <textarea
              value={brainDump}
              onChange={(e) => setBrainDump(e.target.value)}
              rows={8}
              placeholder="Buy detergent&#10;Email Sasha re: deadline&#10;Try that new pasta place"
              className="bg-surface-0 border border-border rounded p-2 text-sm font-mono"
            />
            <button
              onClick={submitBrainDump}
              disabled={!brainDump.trim()}
              className="self-end px-3 py-1 rounded bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-40 text-sm"
            >
              Capture all
            </button>
          </div>
        )}

        <div className="flex items-center justify-between mt-8">
          <button
            onClick={prev}
            disabled={step === 1}
            className="flex items-center gap-1 px-3 py-1.5 text-sm text-text-muted disabled:opacity-30"
          >
            <ChevronLeft size={14} /> Back
          </button>
          {step < STEPS.length ? (
            <button
              onClick={next}
              className="flex items-center gap-1 px-3 py-1.5 rounded bg-accent/15 text-accent hover:bg-accent/25 text-sm"
            >
              Next <ChevronRight size={14} />
            </button>
          ) : (
            <button
              onClick={finish}
              className="px-4 py-1.5 rounded bg-accent text-surface-0 hover:bg-accent/90 text-sm"
            >
              Finish review
            </button>
          )}
        </div>

        <div className="flex items-center justify-center gap-1 mt-6">
          {STEPS.map((s) => (
            <span
              key={s.id}
              className={
                s.id === step
                  ? 'w-2 h-2 rounded-full bg-accent'
                  : 'w-2 h-2 rounded-full bg-border'
              }
            />
          ))}
        </div>

        {/* Suppress unused config warning when contexts are unneeded. */}
        <span className="hidden">{config?.contexts?.length ?? 0}</span>
      </div>
    </div>
  );
}
