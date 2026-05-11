import { useEffect, useRef, useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { useGardenStore } from '@/stores/garden';
import type { InboxItem, ProcessTarget } from '@/types/garden';

interface Props {
  item: InboxItem;
}

export function ProcessDropdown({ item }: Props) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<
    | { kind: 'menu' }
    | { kind: 'next'; context: string; project: string; energy: string; duration: string }
    | { kind: 'project'; outcome: string; firstAction: string; actionContext: string }
    | { kind: 'waiting'; from: string; project: string }
    | { kind: 'someday'; area: string }
    | { kind: 'reference'; notePath: string }
  >({ kind: 'menu' });
  const ref = useRef<HTMLDivElement>(null);
  const config = useGardenStore((s) => s.config);
  const projects = useGardenStore((s) => s.projects);
  const processInbox = useGardenStore((s) => s.processInbox);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
        setStage({ kind: 'menu' });
      }
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open]);

  const submit = async (target: ProcessTarget) => {
    try {
      await processInbox(item.id, target);
      setOpen(false);
      setStage({ kind: 'menu' });
    } catch (e) {
      // Surface the failure so the user knows why nothing happened (e.g.
      // reference path collides with an existing note).
      console.error('process failed:', e);
      window.alert(`Couldn't process item: ${e}`);
    }
  };

  const contexts = config?.contexts ?? ['@везде'];
  const areas = config?.areas ?? ['work', 'personal', 'study', 'hobby'];

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1 px-2 py-1 rounded text-xs border border-border bg-surface-1 hover:bg-surface-2 text-text-secondary"
      >
        Process <ChevronDown size={12} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 bg-surface-1 border border-border rounded-md shadow-xl min-w-[280px] overflow-hidden">
          {stage.kind === 'menu' && (
            <ul className="py-1 text-sm">
              <li>
                <button
                  className="w-full px-3 py-1.5 text-left hover:bg-surface-hover"
                  onClick={() =>
                    setStage({
                      kind: 'next',
                      context: contexts[0] ?? '@везде',
                      project: '',
                      energy: '',
                      duration: '',
                    })
                  }
                >
                  → Next Action
                </button>
              </li>
              <li>
                <button
                  className="w-full px-3 py-1.5 text-left hover:bg-surface-hover"
                  onClick={() =>
                    setStage({
                      kind: 'project',
                      outcome: '',
                      firstAction: '',
                      actionContext: contexts[0] ?? '@везде',
                    })
                  }
                >
                  → Project
                </button>
              </li>
              <li>
                <button
                  className="w-full px-3 py-1.5 text-left hover:bg-surface-hover"
                  onClick={() => setStage({ kind: 'waiting', from: '', project: '' })}
                >
                  → Waiting For
                </button>
              </li>
              <li>
                <button
                  className="w-full px-3 py-1.5 text-left hover:bg-surface-hover"
                  onClick={() => setStage({ kind: 'someday', area: areas[0] ?? '' })}
                >
                  → Someday
                </button>
              </li>
              <li>
                <button
                  className="w-full px-3 py-1.5 text-left hover:bg-surface-hover"
                  onClick={() => {
                    const stem = item.text
                      .replace(/[\\/<>:|"?*\n\r]+/g, ' ')
                      .trim()
                      .slice(0, 60) || 'note';
                    setStage({ kind: 'reference', notePath: `${stem}.md` });
                  }}
                >
                  → Reference
                </button>
              </li>
              <li>
                <button
                  className="w-full px-3 py-1.5 text-left hover:bg-error/15 text-error"
                  onClick={() => submit({ kind: 'trash' })}
                >
                  → Trash
                </button>
              </li>
            </ul>
          )}

          {stage.kind === 'next' && (
            <div className="p-3 flex flex-col gap-2 text-xs">
              <div className="text-text-muted">{item.text}</div>
              <label className="flex items-center gap-2">
                <span className="w-16 text-text-muted">Context</span>
                <select
                  className="flex-1 bg-surface-0 border border-border rounded px-1 py-0.5"
                  value={stage.context}
                  onChange={(e) => setStage({ ...stage, context: e.target.value })}
                >
                  {contexts.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-2">
                <span className="w-16 text-text-muted">Project</span>
                <input
                  list="garden-project-list"
                  className="flex-1 bg-surface-0 border border-border rounded px-1 py-0.5"
                  value={stage.project}
                  onChange={(e) => setStage({ ...stage, project: e.target.value })}
                  placeholder="(none)"
                />
                <datalist id="garden-project-list">
                  {projects.map((p) => (
                    <option key={p.id} value={p.title} />
                  ))}
                </datalist>
              </label>
              <label className="flex items-center gap-2">
                <span className="w-16 text-text-muted">Energy</span>
                <select
                  className="flex-1 bg-surface-0 border border-border rounded px-1 py-0.5"
                  value={stage.energy}
                  onChange={(e) => setStage({ ...stage, energy: e.target.value })}
                >
                  <option value="">—</option>
                  <option value="высокая">высокая</option>
                  <option value="средняя">средняя</option>
                  <option value="низкая">низкая</option>
                </select>
              </label>
              <label className="flex items-center gap-2">
                <span className="w-16 text-text-muted">Time</span>
                <select
                  className="flex-1 bg-surface-0 border border-border rounded px-1 py-0.5"
                  value={stage.duration}
                  onChange={(e) => setStage({ ...stage, duration: e.target.value })}
                >
                  <option value="">—</option>
                  <option value="< 5 мин">{'< 5 мин'}</option>
                  <option value="< 30 мин">{'< 30 мин'}</option>
                  <option value="< 2 ч">{'< 2 ч'}</option>
                  <option value="2+ ч">{'2+ ч'}</option>
                </select>
              </label>
              <div className="flex justify-end gap-2 mt-1">
                <button
                  className="px-2 py-1 text-text-muted hover:text-text-primary"
                  onClick={() => setStage({ kind: 'menu' })}
                >
                  Back
                </button>
                <button
                  className="px-3 py-1 rounded bg-accent/15 text-accent hover:bg-accent/25"
                  onClick={() =>
                    submit({
                      kind: 'next_action',
                      context: stage.context,
                      project: stage.project || null,
                      energy: stage.energy || null,
                      duration: stage.duration || null,
                    })
                  }
                >
                  Create
                </button>
              </div>
            </div>
          )}

          {stage.kind === 'project' && (
            <div className="p-3 flex flex-col gap-2 text-xs">
              <div className="text-text-muted">Title: {item.text}</div>
              <input
                className="bg-surface-0 border border-border rounded px-1 py-0.5"
                placeholder="Outcome (one sentence)"
                value={stage.outcome}
                onChange={(e) => setStage({ ...stage, outcome: e.target.value })}
              />
              <input
                className="bg-surface-0 border border-border rounded px-1 py-0.5"
                placeholder="First next action (highly recommended)"
                value={stage.firstAction}
                onChange={(e) => setStage({ ...stage, firstAction: e.target.value })}
              />
              <select
                className="bg-surface-0 border border-border rounded px-1 py-0.5"
                value={stage.actionContext}
                onChange={(e) => setStage({ ...stage, actionContext: e.target.value })}
              >
                {contexts.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <div className="flex justify-end gap-2 mt-1">
                <button
                  className="px-2 py-1 text-text-muted hover:text-text-primary"
                  onClick={() => setStage({ kind: 'menu' })}
                >
                  Back
                </button>
                <button
                  className="px-3 py-1 rounded bg-accent/15 text-accent hover:bg-accent/25"
                  onClick={() =>
                    submit({
                      kind: 'project',
                      outcome: stage.outcome,
                      first_action: stage.firstAction,
                      action_context: stage.actionContext,
                    })
                  }
                >
                  Create
                </button>
              </div>
            </div>
          )}

          {stage.kind === 'waiting' && (
            <div className="p-3 flex flex-col gap-2 text-xs">
              <input
                className="bg-surface-0 border border-border rounded px-1 py-0.5"
                placeholder="From whom?"
                value={stage.from}
                onChange={(e) => setStage({ ...stage, from: e.target.value })}
              />
              <input
                list="garden-project-list"
                className="bg-surface-0 border border-border rounded px-1 py-0.5"
                placeholder="Project (optional)"
                value={stage.project}
                onChange={(e) => setStage({ ...stage, project: e.target.value })}
              />
              <div className="flex justify-end gap-2 mt-1">
                <button
                  className="px-2 py-1 text-text-muted hover:text-text-primary"
                  onClick={() => setStage({ kind: 'menu' })}
                >
                  Back
                </button>
                <button
                  className="px-3 py-1 rounded bg-accent/15 text-accent hover:bg-accent/25"
                  onClick={() =>
                    submit({
                      kind: 'waiting_for',
                      from: stage.from,
                      project: stage.project || null,
                    })
                  }
                >
                  Add
                </button>
              </div>
            </div>
          )}

          {stage.kind === 'someday' && (
            <div className="p-3 flex flex-col gap-2 text-xs">
              <select
                className="bg-surface-0 border border-border rounded px-1 py-0.5"
                value={stage.area}
                onChange={(e) => setStage({ ...stage, area: e.target.value })}
              >
                {areas.map((a) => (
                  <option key={a} value={a}>
                    {a}
                  </option>
                ))}
              </select>
              <div className="flex justify-end gap-2 mt-1">
                <button
                  className="px-2 py-1 text-text-muted hover:text-text-primary"
                  onClick={() => setStage({ kind: 'menu' })}
                >
                  Back
                </button>
                <button
                  className="px-3 py-1 rounded bg-accent/15 text-accent hover:bg-accent/25"
                  onClick={() => submit({ kind: 'someday', area: stage.area || null })}
                >
                  Add
                </button>
              </div>
            </div>
          )}

          {stage.kind === 'reference' && (
            <div className="p-3 flex flex-col gap-2 text-xs">
              <label className="flex flex-col gap-1">
                <span className="text-text-muted">Save as note</span>
                <input
                  className="bg-surface-0 border border-border rounded px-1 py-0.5"
                  value={stage.notePath}
                  onChange={(e) => setStage({ ...stage, notePath: e.target.value })}
                  placeholder="path/to/file.md"
                />
              </label>
              <div className="flex justify-end gap-2 mt-1">
                <button
                  className="px-2 py-1 text-text-muted hover:text-text-primary"
                  onClick={() => setStage({ kind: 'menu' })}
                >
                  Back
                </button>
                <button
                  className="px-3 py-1 rounded bg-accent/15 text-accent hover:bg-accent/25"
                  onClick={() => submit({ kind: 'reference', note_path: stage.notePath })}
                >
                  Create note
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
