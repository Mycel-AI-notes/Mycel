import { useEffect, useRef, useState } from 'react';
import {
  Lightbulb,
  Plus,
  Trash2,
  ChevronDown,
  Zap,
  ClipboardList,
  Inbox as InboxIcon,
} from 'lucide-react';
import { useGardenStore } from '@/stores/garden';
import { Select } from '@/components/ui/Select';
import type { SomedayItem } from '@/types/garden';

function PromoteDropdown({ item }: { item: SomedayItem }) {
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState<
    | { kind: 'menu' }
    | { kind: 'action'; context: string }
  >({ kind: 'menu' });
  const ref = useRef<HTMLDivElement>(null);
  const addAction = useGardenStore((s) => s.addAction);
  const addProject = useGardenStore((s) => s.addProject);
  const capture = useGardenStore((s) => s.capture);
  const deleteSomeday = useGardenStore((s) => s.deleteSomeday);
  const config = useGardenStore((s) => s.config);
  const contexts = config?.contexts ?? ['@везде'];

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (ref.current?.contains(target)) return;
      if (target.closest('.db-select-list')) return;
      setOpen(false);
      setStage({ kind: 'menu' });
    };
    window.addEventListener('mousedown', handler);
    return () => window.removeEventListener('mousedown', handler);
  }, [open]);

  const finish = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await deleteSomeday(item.id);
    } finally {
      setOpen(false);
      setStage({ kind: 'menu' });
    }
  };

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] border border-border text-text-secondary hover:bg-surface-hover"
      >
        Promote <ChevronDown size={11} />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 z-30 bg-surface-1 border border-border rounded-md shadow-xl min-w-[200px] overflow-hidden">
          {stage.kind === 'menu' && (
            <ul className="py-1 text-sm">
              <li>
                <button
                  className="w-full px-3 py-1.5 text-left hover:bg-surface-hover inline-flex items-center gap-2"
                  onClick={() => setStage({ kind: 'action', context: contexts[0] ?? '@везде' })}
                >
                  <Zap size={13} className="text-accent" /> Next Action
                </button>
              </li>
              <li>
                <button
                  className="w-full px-3 py-1.5 text-left hover:bg-surface-hover inline-flex items-center gap-2"
                  onClick={() => finish(() => addProject({ title: item.text }))}
                >
                  <ClipboardList size={13} className="text-accent-deep" /> Project
                </button>
              </li>
              <li>
                <button
                  className="w-full px-3 py-1.5 text-left hover:bg-surface-hover inline-flex items-center gap-2"
                  onClick={() => finish(() => capture(item.text))}
                  title="Send back to inbox for re-processing"
                >
                  <InboxIcon size={13} className="text-accent-deep" /> Back to Inbox
                </button>
              </li>
            </ul>
          )}

          {stage.kind === 'action' && (
            <div className="p-3 flex flex-col gap-2 text-xs">
              <div className="text-text-muted">{item.text}</div>
              <label className="flex items-center gap-2">
                <span className="w-14 text-text-muted">Context</span>
                <div className="flex-1">
                  <Select
                    value={stage.context}
                    onChange={(v) => setStage({ kind: 'action', context: v })}
                    options={contexts.map((c) => ({ value: c, label: c }))}
                    width="100%"
                  />
                </div>
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
                    finish(() =>
                      addAction({ action: item.text, context: stage.context }),
                    )
                  }
                >
                  Create
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export function SomedayView() {
  const someday = useGardenStore((s) => s.someday);
  const loadSomeday = useGardenStore((s) => s.loadSomeday);
  const addSomeday = useGardenStore((s) => s.addSomeday);
  const deleteSomeday = useGardenStore((s) => s.deleteSomeday);
  const config = useGardenStore((s) => s.config);
  const [text, setText] = useState('');
  const [area, setArea] = useState<string>('');

  useEffect(() => {
    void loadSomeday();
  }, [loadSomeday]);

  const submit = async () => {
    const t = text.trim();
    if (!t) return;
    await addSomeday({ text: t, area: area || null });
    setText('');
  };

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center gap-2 mb-4">
          <Lightbulb size={20} className="text-text-muted" />
          <h1 className="text-xl text-text-primary">Someday / Maybe</h1>
        </div>

        <div className="flex items-center gap-2 mb-4">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') submit();
            }}
            placeholder="An idea, a dream, a someday…"
            className="flex-1 bg-surface-0 border border-border rounded px-2 py-1.5 text-sm"
          />
          <Select
            value={area}
            onChange={setArea}
            options={[
              { value: '', label: '— area —' },
              ...(config?.areas ?? []).map((a) => ({ value: a, label: a })),
            ]}
            width={130}
          />
          <button
            onClick={submit}
            disabled={!text.trim()}
            className="flex items-center gap-1 px-3 py-1.5 rounded text-sm bg-accent/15 text-accent hover:bg-accent/25 disabled:opacity-40"
          >
            <Plus size={14} /> Add
          </button>
        </div>

        {someday.length === 0 ? (
          <p className="text-text-muted text-sm py-12 text-center">
            No ideas filed yet. Drop one above without pressure.
          </p>
        ) : (
          <ul className="flex flex-col gap-1">
            {someday.map((item) => (
              <li
                key={item.id}
                className="group flex items-center gap-2 px-3 py-2 rounded hover:bg-surface-hover"
              >
                <Lightbulb size={13} className="text-text-muted shrink-0" />
                <span className="flex-1 text-sm text-text-primary">{item.text}</span>
                {item.area && (
                  <span className="text-[11px] text-text-muted">{item.area}</span>
                )}
                <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1">
                  <PromoteDropdown item={item} />
                  <button
                    onClick={() => deleteSomeday(item.id)}
                    className="p-1 rounded text-text-muted hover:bg-error/15 hover:text-error"
                    title="Delete"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
