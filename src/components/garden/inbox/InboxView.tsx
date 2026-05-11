import { useEffect } from 'react';
import { Inbox, Plus, Trash2 } from 'lucide-react';
import { useGardenStore } from '@/stores/garden';
import { useVaultStore } from '@/stores/vault';
import { ProcessDropdown } from './ProcessDropdown';
import { PageLink } from '../shared/badges';

export function InboxView() {
  const inbox = useGardenStore((s) => s.inbox);
  const loadInbox = useGardenStore((s) => s.loadInbox);
  const deleteInbox = useGardenStore((s) => s.deleteInbox);
  const openCapture = useGardenStore((s) => s.openCapture);
  const openNote = useVaultStore((s) => s.openNote);

  useEffect(() => {
    void loadInbox();
  }, [loadInbox]);

  return (
    <div className="flex-1 overflow-y-auto p-6">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between mb-4">
          <h1 className="flex items-center gap-2 text-xl text-text-primary">
            <Inbox size={20} className="text-accent" /> Inbox
            <span className="text-text-muted text-sm">({inbox.length})</span>
          </h1>
          <button
            type="button"
            onClick={openCapture}
            className="flex items-center gap-1 px-3 py-1.5 rounded text-sm bg-accent/15 text-accent hover:bg-accent/25"
          >
            <Plus size={14} /> Capture (⌘I)
          </button>
        </div>

        {inbox.length === 0 ? (
          <p className="text-text-muted text-sm py-12 text-center">
            Inbox zero. Mind clear, time to work.
          </p>
        ) : (
          <ul className="flex flex-col gap-2">
            {inbox.map((item) => (
              <li
                key={item.id}
                className="border border-border rounded-md bg-surface-1 p-3 flex flex-col gap-2"
              >
                <div className="flex items-start gap-3">
                  <span className="mt-1 w-3 h-3 shrink-0 rounded-full border border-text-muted" />
                  <div className="flex-1 text-sm text-text-primary whitespace-pre-wrap break-words">
                    {item.text}
                  </div>
                  <ProcessDropdown item={item} />
                  <button
                    type="button"
                    onClick={() => deleteInbox(item.id)}
                    className="p-1 rounded text-text-muted hover:bg-error/15 hover:text-error"
                    title="Delete"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="pl-6 flex items-center gap-3 text-[11px] text-text-muted">
                  <PageLink page={item.page} onOpen={(p) => openNote(p)} />
                  <span>captured {new Date(item.captured_at).toLocaleString()}</span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
