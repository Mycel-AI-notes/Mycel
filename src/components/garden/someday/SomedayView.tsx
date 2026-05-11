import { useEffect, useState } from 'react';
import { Lightbulb, Plus, Trash2, ArrowRight } from 'lucide-react';
import { useGardenStore } from '@/stores/garden';
import { Select } from '@/components/ui/Select';

export function SomedayView() {
  const someday = useGardenStore((s) => s.someday);
  const loadSomeday = useGardenStore((s) => s.loadSomeday);
  const addSomeday = useGardenStore((s) => s.addSomeday);
  const deleteSomeday = useGardenStore((s) => s.deleteSomeday);
  const addProject = useGardenStore((s) => s.addProject);
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

  const promote = async (id: string, ideaText: string) => {
    await addProject({ title: ideaText });
    await deleteSomeday(id);
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
                <span className="text-text-muted">💭</span>
                <span className="flex-1 text-sm text-text-primary">{item.text}</span>
                {item.area && (
                  <span className="text-[11px] text-text-muted">{item.area}</span>
                )}
                <button
                  onClick={() => promote(item.id, item.text)}
                  className="opacity-0 group-hover:opacity-100 px-2 py-0.5 rounded text-[11px] border border-border hover:bg-surface-hover"
                  title="Promote to Project"
                >
                  <ArrowRight size={11} className="inline" /> Project
                </button>
                <button
                  onClick={() => deleteSomeday(item.id)}
                  className="opacity-0 group-hover:opacity-100 p-1 rounded text-text-muted hover:bg-error/15 hover:text-error"
                >
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
