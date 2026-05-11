import { useEffect, useMemo, useState } from 'react';
import { ClipboardList, Plus, AlertTriangle, ExternalLink, FilePlus } from 'lucide-react';
import { useGardenStore } from '@/stores/garden';
import { useVaultStore } from '@/stores/vault';
import type { ProjectItem } from '@/types/garden';
import { KNOWLEDGE_BASE_DIR } from '@/types';

function ProjectRow({ project }: { project: ProjectItem }) {
  const setView = useGardenStore((s) => s.setView);
  const actions = useGardenStore((s) => s.actions);
  const openNote = useVaultStore((s) => s.openNote);

  const liveActions = actions.filter(
    (a) => a.project === project.title && !a.done,
  ).length;
  const isStale = liveActions === 0 && project.status === 'active';

  return (
    <button
      type="button"
      onClick={() => setView({ kind: 'project-detail', id: project.id })}
      className="w-full text-left border border-border rounded-md bg-surface-1 hover:bg-surface-2 p-3 flex items-start gap-3"
    >
      <ClipboardList size={16} className="text-accent-deep mt-0.5 shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-text-primary text-sm font-medium truncate">
            {project.title}
          </span>
          <span className="text-[11px] text-text-muted">
            ⚡ {liveActions} action{liveActions === 1 ? '' : 's'}
          </span>
          {isStale && (
            <span title="No next action — review this project" className="text-error">
              <AlertTriangle size={12} />
            </span>
          )}
          {project.page && (
            <span
              role="button"
              onClick={(e) => {
                e.stopPropagation();
                openNote(project.page!);
              }}
              className="text-[11px] text-text-muted hover:text-accent inline-flex items-center gap-0.5"
            >
              📄
            </span>
          )}
        </div>
        {project.outcome && (
          <div className="text-xs text-text-muted mt-0.5">{project.outcome}</div>
        )}
        {project.deadline && (
          <div className="text-[11px] text-amber-500 mt-0.5">
            ⚠ deadline: {project.deadline}
          </div>
        )}
      </div>
    </button>
  );
}

function NewProjectDialog({ onClose }: { onClose: () => void }) {
  const addProject = useGardenStore((s) => s.addProject);
  const [title, setTitle] = useState('');
  const [outcome, setOutcome] = useState('');
  const [deadline, setDeadline] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const t = title.trim();
    if (!t || busy) return;
    setBusy(true);
    try {
      await addProject({
        title: t,
        outcome: outcome.trim(),
        deadline: deadline || null,
      });
      onClose();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/35" onClick={onClose}>
      <div
        className="bg-surface-1 border border-border rounded-lg p-4 w-full max-w-md flex flex-col gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-sm font-semibold text-text-primary">New project</h2>
        <input
          autoFocus
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          className="bg-surface-0 border border-border rounded px-2 py-1 text-sm"
        />
        <input
          placeholder="Desired outcome"
          value={outcome}
          onChange={(e) => setOutcome(e.target.value)}
          className="bg-surface-0 border border-border rounded px-2 py-1 text-sm"
        />
        <input
          type="date"
          value={deadline}
          onChange={(e) => setDeadline(e.target.value)}
          className="bg-surface-0 border border-border rounded px-2 py-1 text-sm"
        />
        <div className="flex justify-end gap-2 mt-2">
          <button onClick={onClose} className="px-3 py-1 text-sm text-text-muted">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={!title.trim() || busy}
            className="px-3 py-1 rounded text-sm bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-40"
          >
            Create
          </button>
        </div>
      </div>
    </div>
  );
}

export function ProjectsView() {
  const projects = useGardenStore((s) => s.projects);
  const loadProjects = useGardenStore((s) => s.loadProjects);
  const loadActions = useGardenStore((s) => s.loadActions);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    void loadProjects();
    void loadActions();
  }, [loadProjects, loadActions]);

  const groups = useMemo(() => {
    const active: ProjectItem[] = [];
    const paused: ProjectItem[] = [];
    const done: ProjectItem[] = [];
    for (const p of projects) {
      if (p.status === 'paused') paused.push(p);
      else if (p.status === 'done') done.push(p);
      else active.push(p);
    }
    return { active, paused, done };
  }, [projects]);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h1 className="flex items-center gap-2 text-xl text-text-primary">
            <ClipboardList size={20} className="text-accent-deep" /> Projects
          </h1>
          <button
            onClick={() => setCreating(true)}
            className="flex items-center gap-1 px-3 py-1.5 rounded text-sm bg-accent/15 text-accent hover:bg-accent/25"
          >
            <Plus size={14} /> New project
          </button>
        </div>

        {projects.length === 0 ? (
          <p className="text-text-muted text-sm py-12 text-center">
            No projects yet. Anything that takes more than one step belongs here.
          </p>
        ) : (
          <div className="flex flex-col gap-6">
            {groups.active.length > 0 && (
              <section className="flex flex-col gap-2">
                <header className="text-xs uppercase tracking-wider text-text-muted">
                  Active ({groups.active.length})
                </header>
                {groups.active.map((p) => (
                  <ProjectRow key={p.id} project={p} />
                ))}
              </section>
            )}
            {groups.paused.length > 0 && (
              <section className="flex flex-col gap-2">
                <header className="text-xs uppercase tracking-wider text-text-muted">
                  Paused ({groups.paused.length})
                </header>
                {groups.paused.map((p) => (
                  <ProjectRow key={p.id} project={p} />
                ))}
              </section>
            )}
            {groups.done.length > 0 && (
              <section className="flex flex-col gap-2">
                <header className="text-xs uppercase tracking-wider text-text-muted">
                  Done ({groups.done.length})
                </header>
                {groups.done.map((p) => (
                  <ProjectRow key={p.id} project={p} />
                ))}
              </section>
            )}
          </div>
        )}
      </div>

      {creating && <NewProjectDialog onClose={() => setCreating(false)} />}
    </div>
  );
}

export function ProjectDetailView({ id }: { id: string }) {
  const setView = useGardenStore((s) => s.setView);
  const updateProject = useGardenStore((s) => s.updateProject);
  const deleteProject = useGardenStore((s) => s.deleteProject);
  const completeAction = useGardenStore((s) => s.completeAction);
  const addAction = useGardenStore((s) => s.addAction);
  const completeWaiting = useGardenStore((s) => s.completeWaiting);
  const config = useGardenStore((s) => s.config);
  const projects = useGardenStore((s) => s.projects);
  const actions = useGardenStore((s) => s.actions);
  const waiting = useGardenStore((s) => s.waiting);
  const loadActions = useGardenStore((s) => s.loadActions);
  const loadWaiting = useGardenStore((s) => s.loadWaiting);
  const loadProjects = useGardenStore((s) => s.loadProjects);
  const createPage = useGardenStore((s) => s.createPage);
  const openNote = useVaultStore((s) => s.openNote);

  const project = projects.find((p) => p.id === id);
  const [newAction, setNewAction] = useState('');
  const [actionContext, setActionContext] = useState(config?.contexts?.[0] ?? '@везде');

  useEffect(() => {
    void loadProjects();
    void loadActions();
    void loadWaiting();
  }, [loadProjects, loadActions, loadWaiting]);

  if (!project) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-muted text-sm">
        Project not found.
        <button
          className="ml-2 underline"
          onClick={() => setView({ kind: 'projects' })}
        >
          Back
        </button>
      </div>
    );
  }

  const projActions = actions.filter((a) => a.project === project.title);
  const live = projActions.filter((a) => !a.done);
  const completed = projActions.filter((a) => a.done);
  const projWaiting = waiting.filter((w) => w.project === project.title);

  const submitAction = async () => {
    const t = newAction.trim();
    if (!t) return;
    await addAction({
      action: t,
      context: actionContext,
      project: project.title,
    });
    setNewAction('');
  };

  const openOrCreatePage = async () => {
    if (project.page) {
      await openNote(project.page);
      return;
    }
    const safe = project.title.replace(/[\\/<>:|"?*\n\r]+/g, ' ').trim().slice(0, 80);
    const path = `${KNOWLEDGE_BASE_DIR}/projects/${safe}.md`;
    try {
      await createPage('projects', project.id, path, project.title);
      await openNote(path);
    } catch (e) {
      console.error(e);
      window.alert(`Couldn't create page: ${e}`);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto">
        <button
          onClick={() => setView({ kind: 'projects' })}
          className="text-xs text-text-muted hover:text-text-primary mb-2"
        >
          ← Projects
        </button>

        <div className="flex items-start justify-between mb-3">
          <div>
            <h1 className="flex items-center gap-2 text-xl text-text-primary">
              <ClipboardList size={20} className="text-accent-deep" />
              {project.title}
            </h1>
            {project.outcome && (
              <p className="text-text-muted text-sm mt-1">Outcome: {project.outcome}</p>
            )}
            <div className="flex items-center gap-3 mt-2 text-xs text-text-muted">
              <select
                value={project.status}
                onChange={(e) => updateProject(project.id, { status: e.target.value })}
                className="bg-surface-0 border border-border rounded px-1 py-0.5"
              >
                <option value="active">active</option>
                <option value="paused">paused</option>
                <option value="done">done</option>
              </select>
              {project.deadline && <span className="text-amber-500">⚠ {project.deadline}</span>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={openOrCreatePage}
              className="flex items-center gap-1 px-2 py-1 rounded text-xs border border-border hover:bg-surface-hover"
            >
              {project.page ? (
                <>
                  <ExternalLink size={12} /> Open page
                </>
              ) : (
                <>
                  <FilePlus size={12} /> Create page
                </>
              )}
            </button>
            <button
              onClick={async () => {
                const ok = window.confirm(`Delete project "${project.title}"?`);
                if (ok) {
                  await deleteProject(project.id);
                  setView({ kind: 'projects' });
                }
              }}
              className="px-2 py-1 rounded text-xs text-error hover:bg-error/15"
            >
              Delete
            </button>
          </div>
        </div>

        <section className="mt-6">
          <header className="text-xs uppercase tracking-wider text-text-muted mb-1">
            ⚡ Next Actions ({live.length})
          </header>
          <ul className="flex flex-col">
            {live.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-2 px-2 py-1 rounded hover:bg-surface-hover text-sm"
              >
                <button
                  onClick={() => completeAction(a.id, true)}
                  className="w-4 h-4 rounded-full border border-text-muted hover:border-accent"
                />
                <span className="flex-1">{a.action}</span>
                <span className="text-[11px] text-text-muted">{a.context}</span>
                {a.duration && <span className="text-[11px] text-text-muted">{a.duration}</span>}
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2 mt-2">
            <input
              value={newAction}
              onChange={(e) => setNewAction(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') submitAction();
              }}
              placeholder="+ Add next action"
              className="flex-1 bg-surface-0 border border-border rounded px-2 py-1 text-sm"
            />
            <select
              value={actionContext}
              onChange={(e) => setActionContext(e.target.value)}
              className="bg-surface-0 border border-border rounded text-xs px-1 py-1"
            >
              {(config?.contexts ?? []).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
          </div>
        </section>

        {projWaiting.length > 0 && (
          <section className="mt-6">
            <header className="text-xs uppercase tracking-wider text-text-muted mb-1">
              ⏳ Waiting For ({projWaiting.length})
            </header>
            <ul className="flex flex-col">
              {projWaiting.map((w) => (
                <li
                  key={w.id}
                  className="flex items-center gap-2 px-2 py-1 rounded hover:bg-surface-hover text-sm"
                >
                  <button
                    onClick={() => completeWaiting(w.id, true)}
                    className="w-4 h-4 rounded-full border border-text-muted hover:border-accent"
                  />
                  <span className="flex-1">{w.what}</span>
                  <span className="text-[11px] text-text-muted">since {w.since}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {completed.length > 0 && (
          <section className="mt-6">
            <header className="text-xs uppercase tracking-wider text-text-muted mb-1">
              ✓ Completed ({completed.length})
            </header>
            <ul className="flex flex-col">
              {completed.map((a) => (
                <li
                  key={a.id}
                  className="flex items-center gap-2 px-2 py-1 text-sm text-text-muted line-through"
                >
                  <span className="w-4 h-4 rounded-full bg-accent/30" />
                  <span className="flex-1">{a.action}</span>
                  {a.done_at && (
                    <span className="text-[11px]">
                      {new Date(a.done_at).toLocaleDateString()}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
