import { useEffect, useRef, useState } from 'react';
import { Inbox, X, Check } from 'lucide-react';
import { useGardenStore } from '@/stores/garden';

export function QuickCapture() {
  const open = useGardenStore((s) => s.captureOpen);
  const close = useGardenStore((s) => s.closeCapture);
  const capture = useGardenStore((s) => s.capture);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setText('');
      setFlash(false);
      // Focus needs a tick — the input may not be mounted in the same frame.
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  // Window-level Esc — guarantees the modal closes even if focus drifted out
  // of the input (e.g. user clicked the backdrop without releasing focus).
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        close();
      }
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [open, close]);

  if (!open) return null;

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    try {
      await capture(trimmed);
      setText('');
      setFlash(true);
      setTimeout(() => setFlash(false), 700);
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
              }
            }}
            placeholder="What's on your mind?"
            className="flex-1 bg-transparent outline-none text-text-primary text-base placeholder:text-text-muted"
            disabled={busy}
          />
          {flash && (
            <span className="flex items-center gap-1 text-accent text-xs animate-pulse">
              <Check size={14} /> Captured
            </span>
          )}
          <button
            onClick={close}
            className="p-1 rounded text-text-muted hover:bg-surface-hover hover:text-text-primary"
            title="Close (Esc)"
          >
            <X size={14} />
          </button>
        </div>
        <div className="flex items-center justify-between px-4 py-2 text-[11px] text-text-muted">
          <span>↵ to capture · Esc to close · keep typing for more</span>
          <span>Saves to Inbox</span>
        </div>
      </div>
    </div>
  );
}
