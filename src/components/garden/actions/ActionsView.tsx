import { useEffect, useMemo, useRef, useState } from 'react';
import { Zap, Trash2, Check, SlidersHorizontal, X, Eraser } from 'lucide-react';
import { clsx } from 'clsx';
import { useGardenStore } from '@/stores/garden';
import { useVaultStore } from '@/stores/vault';
import type { ActionFilters, ActionGrouping, ActionItem } from '@/types/garden';
import { DurationBadge, EnergyBadge, PageLink, ProjectChip } from '../shared/badges';
import { Select } from '@/components/ui/Select';

const GROUPING_LABEL: Record<ActionGrouping, string> = {
  context: 'By context',
  project: 'By project',
  energy: 'By energy',
  duration: 'By duration',
};

const FILTER_LABEL: Record<keyof ActionFilters, string> = {
  context: 'Context',
  project: 'Project',
  energy: 'Energy',
  duration: 'Time',
};

interface FilterPopoverProps {
  filters: ActionFilters;
  setFilters: (f: Partial<ActionFilters>) => void;
  clearFilters: () => void;
  contexts: string[];
  projects: { title: string }[];
}

function FilterPopover({
  filters,
  setFilters,
  clearFilters,
  contexts,
  projects,
}: FilterPopoverProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const activeCount = Object.values(filters).filter(Boolean).length;

  // Click-outside to close — but ignore clicks on Select portals, which
  // mount under document.body outside `ref`.
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (ref.current?.contains(target)) return;
      // Custom Select uses CSS class .db-select-list for its dropdown.
      if (target.closest('.db-select-list')) return;
      setOpen(false);
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          'inline-flex items-center gap-1.5 px-2.5 py-1 rounded text-xs border transition-colors',
          activeCount > 0
            ? 'border-accent/60 text-accent bg-accent/10'
            : 'border-border text-text-secondary hover:bg-surface-hover',
        )}
      >
        <SlidersHorizontal size={12} />
        Filter
        {activeCount > 0 && (
          <span className="ml-0.5 px-1 rounded-full bg-accent/20 text-accent text-[10px] tabular-nums">
            {activeCount}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 bg-surface-1 border border-border rounded-md shadow-xl p-3 min-w-[260px] flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <span className="w-14 text-text-muted text-[11px]">{FILTER_LABEL.context}</span>
            <div className="flex-1">
              <Select
                value={filters.context ?? ''}
                onChange={(v) => setFilters({ context: v || undefined })}
                options={[
                  { value: '', label: 'All' },
                  ...contexts.map((c) => ({ value: c, label: c })),
                ]}
                width="100%"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-14 text-text-muted text-[11px]">{FILTER_LABEL.project}</span>
            <div className="flex-1">
              <Select
                value={filters.project ?? ''}
                onChange={(v) => setFilters({ project: v || undefined })}
                options={[
                  { value: '', label: 'All' },
                  ...projects.map((p) => ({ value: p.title, label: p.title })),
                ]}
                width="100%"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-14 text-text-muted text-[11px]">{FILTER_LABEL.energy}</span>
            <div className="flex-1">
              <Select
                value={filters.energy ?? ''}
                onChange={(v) => setFilters({ energy: v || undefined })}
                options={[
                  { value: '', label: 'All' },
                  { value: 'high', label: 'high' },
                  { value: 'medium', label: 'medium' },
                  { value: 'low', label: 'low' },
                ]}
                width="100%"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-14 text-text-muted text-[11px]">{FILTER_LABEL.duration}</span>
            <div className="flex-1">
              <Select
                value={filters.duration ?? ''}
                onChange={(v) => setFilters({ duration: v || undefined })}
                options={[
                  { value: '', label: 'All' },
                  { value: '< 5 min', label: '< 5 min' },
                  { value: '< 30 min', label: '< 30 min' },
                  { value: '< 2 h', label: '< 2 h' },
                  { value: '2+ h', label: '2+ h' },
                ]}
                width="100%"
              />
            </div>
          </div>
          {activeCount > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              className="self-end mt-1 text-[11px] text-text-muted hover:text-text-primary"
            >
              Reset all
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function groupKey(item: ActionItem, by: ActionGrouping): string {
  switch (by) {
    case 'context': return item.context || '@anywhere';
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

function InlineAdd({ defaultContext }: { defaultContext: string }) {
  const addAction = useGardenStore((s) => s.addAction);
  const config = useGardenStore((s) => s.config);
  const [text, setText] = useState('');
  const [context, setContext] = useState(defaultContext);
  const [busy, setBusy] = useState(false);
  const contexts = config?.contexts ?? ['@anywhere'];

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
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
        }}
        placeholder="What needs to be done? Press Enter to add."
        className="flex-1 bg-transparent outline-none text-sm placeholder:text-text-muted"
      />
      <Select
        value={context}
        onChange={setContext}
        options={contexts.map((c) => ({ value: c, label: c }))}
        width={130}
      />
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
  const clearCompletedActions = useGardenStore((s) => s.clearCompletedActions);
  const projects = useGardenStore((s) => s.projects);

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

  const activeFilters = Object.entries(filters).filter(([, v]) => v) as Array<
    [keyof ActionFilters, string]
  >;
  const completedTotal = useMemo(
    () => actions.filter((a) => a.done).length,
    [actions],
  );

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between gap-3 mb-2">
          <h1 className="flex items-center gap-2 text-xl text-text-primary">
            <Zap size={20} className="text-accent" /> Next Actions
            <span className="text-text-muted text-sm">({filtered.filter((a) => !a.done).length})</span>
          </h1>
          <div className="flex items-center gap-2 text-xs">
            <Select<ActionGrouping>
              value={grouping}
              onChange={setGrouping}
              options={(Object.keys(GROUPING_LABEL) as ActionGrouping[]).map(
                (g) => ({ value: g, label: GROUPING_LABEL[g] }),
              )}
              width={140}
            />
            <FilterPopover
              filters={filters}
              setFilters={setFilters}
              clearFilters={clearFilters}
              contexts={config?.contexts ?? []}
              projects={projects}
            />
            <button
              type="button"
              onClick={() => setHideCompleted(!hideCompleted)}
              className={clsx(
                'inline-flex items-center gap-1 px-2.5 py-1 rounded border text-xs transition-colors',
                hideCompleted
                  ? 'border-accent/60 text-accent bg-accent/10'
                  : 'border-border text-text-secondary hover:bg-surface-hover',
              )}
              title="Hide done items"
            >
              <Check size={12} /> Hide done
            </button>
          </div>
        </div>

        {/* Active filter chips */}
        {activeFilters.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5 mb-3">
            {activeFilters.map(([key, value]) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilters({ [key]: undefined } as Partial<ActionFilters>)}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-accent/12 text-accent text-[11px] hover:bg-accent/20"
                title={`Remove ${FILTER_LABEL[key]} filter`}
              >
                <span className="text-text-muted">{FILTER_LABEL[key]}:</span>
                <span>{value}</span>
                <X size={10} />
              </button>
            ))}
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

        {/* Always-visible inline add — no separate Add button. */}
        <div className="mt-4">
          <InlineAdd defaultContext={config?.contexts?.[0] ?? '@anywhere'} />
        </div>

        {!hideCompleted && completedToday.length > 0 && (
          <section className="mt-8">
            <header className="flex items-center justify-between text-xs uppercase tracking-wider text-text-muted px-3 py-1 border-b border-border">
              <span className="inline-flex items-center gap-1.5">
                <Check size={11} className="text-accent" /> Completed today
              </span>
              <div className="flex items-center gap-2">
                {completedTotal > 0 && (
                  <button
                    type="button"
                    onClick={async () => {
                      const ok = window.confirm(
                        `Permanently delete ${completedTotal} completed action${completedTotal === 1 ? '' : 's'}?`,
                      );
                      if (ok) await clearCompletedActions();
                    }}
                    className="inline-flex items-center gap-1 text-[11px] normal-case text-text-muted hover:text-error"
                    title="Delete every completed action"
                  >
                    <Eraser size={11} /> Clear all done ({completedTotal})
                  </button>
                )}
                <span>{completedToday.length}</span>
              </div>
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
