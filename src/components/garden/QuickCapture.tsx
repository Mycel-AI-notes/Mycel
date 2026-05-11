import { useEffect, useRef, useState } from 'react';
import { Inbox } from 'lucide-react';
import { useGardenStore } from '@/stores/garden';

export function QuickCapture() {
  const open = useGardenStore((s) => s.captureOpen);
  const close = useGardenStore((s) => s.closeCapture);
  const capture = useGardenStore((s) => s.capture);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setText('');
      // Focus needs a tick — the input may not be mounted in the same frame.
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  if (!open) return null;

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await capture(trimmed);
      setText('');
      inputRef.current?.focus();
    } catch (e) {
      console.error('capture failed:', e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh] bg-black/35 backdrop-blur-[2px]"
      onClick={close}
    >
      <div
        className="w-full max-w-xl mx-4 bg-surface-1 border border-border rounded-lg shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border bg-surface-0">
          <Inbox size={18} className="text-accent" />
          <input
            ref={inputRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void submit();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                close();
              }
            }}
            placeholder="What's on your mind?"
            className="flex-1 bg-transparent outline-none text-text-primary text-base placeholder:text-text-muted"
            disabled={busy}
          />
        </div>
        <div className="flex items-center justify-between px-4 py-2 text-[11px] text-text-muted">
          <span>↵ to capture · Esc to close</span>
          <span>Saves to Inbox</span>
        </div>
      </div>
    </div>
  );
}
