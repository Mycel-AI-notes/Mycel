import { useEffect, useMemo, useState } from 'react';
import { Zap, Plus, Trash2, Check, X } from 'lucide-react';
import { clsx } from 'clsx';
import { useGardenStore } from '@/stores/garden';
import { useVaultStore } from '@/stores/vault';
import type { ActionGrouping, ActionItem } from '@/types/garden';
import { DurationBadge, EnergyBadge, PageLink, ProjectChip } from '../shared/badges';

const GROUPING_LABEL: Record<ActionGrouping, string> = {
  context: 'By context',
  project: 'By project',
  energy: 'By energy',
  duration: 'By duration',
};

function groupKey(item: ActionItem, by: ActionGrouping): string {
  switch (by) {
    case 'context': return item.context || '@везде';
    case 'project': return item.project || '— no project';
    case 'energy': return item.energy || '— no energy';
    case 'duration': return item.duration || '— no duration';
  }
}

function ActionRow({ item }: { item: ActionItem }) {
  const completeAction = useGardenStore((s) => s.completeAction);
  const deleteAction = useGardenStore((s) => s.deleteAction);
  const updateAction = useGardenStore((s) => s.updateAction);
  const openNote = useVaultStore((s) => s.openNote);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.action);

  const commit = async () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== item.action) {
      await updateAction(item.id, { action: trimmed });
    }
    setEditing(false);
  };

  return (
    <li className="flex items-start gap-3 px-3 py-1.5 rounded hover:bg-surface-hover">
      <button
        type="button"
        onClick={() => completeAction(item.id, !item.done)}
        className={clsx(
          'mt-0.5 w-4 h-4 shrink-0 rounded-full border flex items-center justify-center transition-colors',
          item.done
            ? 'border-accent bg-accent/30 text-accent'
            : 'border-text-muted hover:border-accent',
        )}
        title={item.done ? 'Mark not done' : 'Mark done'}
      >
        {item.done && <Check size={10} />}
      </button>
      <div className="flex-1 min-w-0">
        {editing ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commit();
              if (e.key === 'Escape') {
                setDraft(item.action);
                setEditing(false);
              }
            }}
            className="w-full bg-surface-0 border border-accent rounded px-1 py-0.5 text-sm text-text-primary outline-none"
          />
        ) : (
          <div
            className={clsx(
              'text-sm cursor-text',
              item.done ? 'text-text-muted line-through' : 'text-text-primary',
            )}
            onDoubleClick={() => {
              setDraft(item.action);
              setEditing(true);
            }}
          >
            {item.action}
          </div>
        )}
        <div className="flex items-center gap-2 mt-0.5 text-[11px] text-text-muted">
          <ProjectChip name={item.project} />
          <DurationBadge duration={item.duration} />
          <EnergyBadge energy={item.energy} />
          <PageLink page={item.page} onOpen={(p) => openNote(p)} />
        </div>
      </div>
      <button
        type="button"
        onClick={() => deleteAction(item.id)}
        className="opacity-0 group-hover:opacity-100 p-1 rounded text-text-muted hover:bg-error/15 hover:text-error"
        title="Delete"
      >
        <Trash2 size={12} />
      </button>
    </li>
  );
}

function InlineAdd({
  defaultContext,
  onDone,
}: {
  defaultContext: string;
  onDone: () => void;
}) {
  const addAction = useGardenStore((s) => s.addAction);
  const config = useGardenStore((s) => s.config);
  const [text, setText] = useState('');
  const [context, setContext] = useState(defaultContext);
  const [busy, setBusy] = useState(false);
  const contexts = config?.contexts ?? ['@везде'];

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await addAction({ action: trimmed, context });
      setText('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex items-center gap-2 px-3 py-2 border border-dashed border-border rounded">
      <span className="w-3 h-3 rounded-full border border-text-muted" />
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') onDone();
        }}
        placeholder="What needs to be done?"
        className="flex-1 bg-transparent outline-none text-sm placeholder:text-text-muted"
      />
      <select
        value={context}
        onChange={(e) => setContext(e.target.value)}
        className="bg-surface-0 border border-border rounded text-xs px-1 py-0.5"
      >
        {contexts.map((c) => (
          <option key={c} value={c}>{c}</option>
        ))}
      </select>
      <button
        type="button"
        onClick={submit}
        disabled={!text.trim()}
        className="px-2 py-1 rounded text-xs bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-40"
      >
        Add
      </button>
      <button
        type="button"
        onClick={onDone}
        className="p-1 rounded text-text-muted hover:bg-surface-hover"
      >
        <X size={14} />
      </button>
    </div>
  );
}

export function ActionsView() {
  const actions = useGardenStore((s) => s.actions);
  const loadActions = useGardenStore((s) => s.loadActions);
  const config = useGardenStore((s) => s.config);
  const grouping = useGardenStore((s) => s.grouping);
  const setGrouping = useGardenStore((s) => s.setGrouping);
  const filters = useGardenStore((s) => s.filters);
  const setFilters = useGardenStore((s) => s.setFilters);
  const clearFilters = useGardenStore((s) => s.clearFilters);
  const hideCompleted = useGardenStore((s) => s.hideCompleted);
  const setHideCompleted = useGardenStore((s) => s.setHideCompleted);
  const projects = useGardenStore((s) => s.projects);

  const [adding, setAdding] = useState(false);

  useEffect(() => {
    void loadActions();
  }, [loadActions]);

  const filtered = useMemo(() => {
    return actions.filter((a) => {
      if (filters.context && a.context !== filters.context) return false;
      if (filters.project && a.project !== filters.project) return false;
      if (filters.energy && a.energy !== filters.energy) return false;
      if (filters.duration && a.duration !== filters.duration) return false;
      if (hideCompleted && a.done) return false;
      return true;
    });
  }, [actions, filters, hideCompleted]);

  const groups = useMemo(() => {
    const map = new Map<string, ActionItem[]>();
    for (const a of filtered) {
      if (a.done) continue;
      const k = groupKey(a, grouping);
      if (!map.has(k)) map.set(k, []);
      map.get(k)!.push(a);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [filtered, grouping]);

  const today = new Date().toDateString();
  const completedToday = useMemo(
    () =>
      actions.filter(
        (a) => a.done && a.done_at && new Date(a.done_at).toDateString() === today,
      ),
    [actions, today],
  );

  const activeFilters = Object.entries(filters).filter(([, v]) => v);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-3">
          <h1 className="flex items-center gap-2 text-xl text-text-primary">
            <Zap size={20} className="text-accent" /> Next Actions
            <span className="text-text-muted text-sm">({filtered.filter((a) => !a.done).length})</span>
          </h1>
          <div className="flex items-center gap-2 text-xs">
            <button
              onClick={() => setAdding(true)}
              className="flex items-center gap-1 px-2 py-1 rounded bg-accent/15 text-accent hover:bg-accent/25"
            >
              <Plus size={12} /> Add
            </button>
            <select
              value={grouping}
              onChange={(e) => setGrouping(e.target.value as ActionGrouping)}
              className="bg-surface-0 border border-border rounded px-1 py-1"
            >
              {(Object.keys(GROUPING_LABEL) as ActionGrouping[]).map((g) => (
                <option key={g} value={g}>{GROUPING_LABEL[g]}</option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-text-muted">
              <input
                type="checkbox"
                checked={hideCompleted}
                onChange={(e) => setHideCompleted(e.target.checked)}
              />
              hide done
            </label>
          </div>
        </div>

        {/* filter row */}
        <div className="flex flex-wrap items-center gap-2 mb-3 text-xs">
          <select
            value={filters.context ?? ''}
            onChange={(e) => setFilters({ context: e.target.value || undefined })}
            className="bg-surface-0 border border-border rounded px-1 py-0.5"
          >
            <option value="">All contexts</option>
            {(config?.contexts ?? []).map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
          <select
            value={filters.project ?? ''}
            onChange={(e) => setFilters({ project: e.target.value || undefined })}
            className="bg-surface-0 border border-border rounded px-1 py-0.5"
          >
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p.id} value={p.title}>{p.title}</option>
            ))}
          </select>
          <select
            value={filters.energy ?? ''}
            onChange={(e) => setFilters({ energy: e.target.value || undefined })}
            className="bg-surface-0 border border-border rounded px-1 py-0.5"
          >
            <option value="">All energy</option>
            <option value="высокая">высокая</option>
            <option value="средняя">средняя</option>
            <option value="низкая">низкая</option>
          </select>
          <select
            value={filters.duration ?? ''}
            onChange={(e) => setFilters({ duration: e.target.value || undefined })}
            className="bg-surface-0 border border-border rounded px-1 py-0.5"
          >
            <option value="">All durations</option>
            <option value="< 5 мин">{'< 5 мин'}</option>
            <option value="< 30 мин">{'< 30 мин'}</option>
            <option value="< 2 ч">{'< 2 ч'}</option>
            <option value="2+ ч">{'2+ ч'}</option>
          </select>
          {activeFilters.length > 0 && (
            <button
              onClick={clearFilters}
              className="px-2 py-0.5 rounded border border-border text-text-muted hover:text-text-primary"
            >
              Clear filters
            </button>
          )}
        </div>

        {adding && (
          <div className="mb-3">
            <InlineAdd
              defaultContext={config?.contexts?.[0] ?? '@везде'}
              onDone={() => setAdding(false)}
            />
          </div>
        )}

        {groups.length === 0 ? (
          <p className="text-text-muted text-sm py-8 text-center">
            Nothing to do here. Add an action or check your inbox.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {groups.map(([key, items]) => (
              <section key={key}>
                <header className="flex items-center justify-between text-xs uppercase tracking-wider text-text-muted px-3 py-1 border-b border-border">
                  <span>{key}</span>
                  <span>{items.length}</span>
                </header>
                <ul className="flex flex-col">
                  {items.map((item) => (
                    <ActionRow key={item.id} item={item} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        )}

        {completedToday.length > 0 && (
          <section className="mt-8">
            <header className="flex items-center justify-between text-xs uppercase tracking-wider text-text-muted px-3 py-1 border-b border-border">
              <span>✓ Completed today</span>
              <span>{completedToday.length}</span>
            </header>
            <ul className="flex flex-col">
              {completedToday.map((item) => (
                <ActionRow key={item.id} item={item} />
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
