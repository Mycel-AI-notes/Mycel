import { useEffect, useState } from 'react';
import { Hourglass, Plus, AlertTriangle, Trash2, Check } from 'lucide-react';
import { clsx } from 'clsx';
import { useGardenStore } from '@/stores/garden';
import type { WaitingItem } from '@/types/garden';

function daysAgo(iso: string): number {
  const since = new Date(iso);
  if (Number.isNaN(since.getTime())) return 0;
  const ms = Date.now() - since.getTime();
  return Math.max(0, Math.floor(ms / 86_400_000));
}

function Row({ item, staleDays }: { item: WaitingItem; staleDays: number }) {
  const completeWaiting = useGardenStore((s) => s.completeWaiting);
  const deleteWaiting = useGardenStore((s) => s.deleteWaiting);
  const days = daysAgo(item.since);
  const stale = !item.done && days > staleDays;

  return (
    <li className="flex items-start gap-3 px-3 py-2 border border-border rounded-md bg-surface-1">
      <button
        onClick={() => completeWaiting(item.id, !item.done)}
        className={clsx(
          'mt-0.5 w-4 h-4 shrink-0 rounded-full border flex items-center justify-center',
          item.done ? 'border-accent bg-accent/30 text-accent' : 'border-text-muted',
        )}
      >
        {item.done && <Check size={10} />}
      </button>
      <div className="flex-1 min-w-0">
        <div className={clsx('text-sm', item.done && 'text-text-muted line-through')}>
          {item.what}
        </div>
        <div className="text-[11px] text-text-muted flex items-center gap-3 mt-0.5">
          {item.from && <span>from {item.from}</span>}
          {item.project && <span>📋 {item.project}</span>}
          <span>since {item.since}</span>
          <span>{days} day{days === 1 ? '' : 's'} ago</span>
          {stale && (
            <span className="text-error inline-flex items-center gap-0.5">
              <AlertTriangle size={11} /> follow up
            </span>
          )}
        </div>
      </div>
      <button
        onClick={() => deleteWaiting(item.id)}
        className="p-1 rounded text-text-muted hover:bg-error/15 hover:text-error"
      >
        <Trash2 size={12} />
      </button>
    </li>
  );
}

function NewWaitingForm({ onClose }: { onClose: () => void }) {
  const addWaiting = useGardenStore((s) => s.addWaiting);
  const projects = useGardenStore((s) => s.projects);
  const [what, setWhat] = useState('');
  const [from, setFrom] = useState('');
  const [project, setProject] = useState('');
  const [since, setSince] = useState(new Date().toISOString().slice(0, 10));

  const submit = async () => {
    const t = what.trim();
    if (!t) return;
    await addWaiting({
      what: t,
      from,
      since,
      project: project || null,
    });
    onClose();
  };

  return (
    <div className="border border-border rounded-md bg-surface-1 p-3 flex flex-col gap-2">
      <input
        autoFocus
        placeholder="What are you waiting for?"
        value={what}
        onChange={(e) => setWhat(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') submit();
          if (e.key === 'Escape') onClose();
        }}
        className="bg-surface-0 border border-border rounded px-2 py-1 text-sm"
      />
      <div className="flex gap-2">
        <input
          placeholder="From whom?"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="flex-1 bg-surface-0 border border-border rounded px-2 py-1 text-sm"
        />
        <input
          list="garden-project-list"
          placeholder="Project"
          value={project}
          onChange={(e) => setProject(e.target.value)}
          className="flex-1 bg-surface-0 border border-border rounded px-2 py-1 text-sm"
        />
        <datalist id="garden-project-list">
          {projects.map((p) => (
            <option key={p.id} value={p.title} />
          ))}
        </datalist>
        <input
          type="date"
          value={since}
          onChange={(e) => setSince(e.target.value)}
          className="bg-surface-0 border border-border rounded px-2 py-1 text-sm"
        />
      </div>
      <div className="flex justify-end gap-2">
        <button onClick={onClose} className="text-xs text-text-muted px-2 py-1">
          Cancel
        </button>
        <button
          onClick={submit}
          disabled={!what.trim()}
          className="text-xs px-2 py-1 rounded bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-40"
        >
          Add
        </button>
      </div>
    </div>
  );
}

export function WaitingView() {
  const waiting = useGardenStore((s) => s.waiting);
  const loadWaiting = useGardenStore((s) => s.loadWaiting);
  const config = useGardenStore((s) => s.config);
  const [adding, setAdding] = useState(false);

  useEffect(() => {
    void loadWaiting();
  }, [loadWaiting]);

  const staleDays = config?.waiting_for_stale_days ?? 14;
  const live = waiting.filter((w) => !w.done);
  const done = waiting.filter((w) => w.done);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h1 className="flex items-center gap-2 text-xl text-text-primary">
            <Hourglass size={20} className="text-text-muted" /> Waiting For
            <span className="text-text-muted text-sm">({live.length})</span>
          </h1>
          <button
            onClick={() => setAdding(true)}
            className="flex items-center gap-1 px-3 py-1.5 rounded text-sm bg-accent/15 text-accent hover:bg-accent/25"
          >
            <Plus size={14} /> Add
          </button>
        </div>

        {adding && (
          <div className="mb-3">
            <NewWaitingForm onClose={() => setAdding(false)} />
          </div>
        )}

        {live.length === 0 && !adding ? (
          <p className="text-text-muted text-sm py-12 text-center">
            Not waiting on anyone. 🎉
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {live.map((item) => (
              <Row key={item.id} item={item} staleDays={staleDays} />
            ))}
          </ul>
        )}

        {done.length > 0 && (
          <section className="mt-8">
            <header className="text-xs uppercase tracking-wider text-text-muted mb-1">
              ✓ Done ({done.length})
            </header>
            <ul className="flex flex-col gap-2">
              {done.map((item) => (
                <Row key={item.id} item={item} staleDays={staleDays} />
              ))}
            </ul>
          </section>
        )}
      </div>
    </div>
  );
}
