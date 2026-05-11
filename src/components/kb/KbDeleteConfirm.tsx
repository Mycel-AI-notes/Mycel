import { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { AlertTriangle, X } from 'lucide-react';
import { useVaultStore } from '@/stores/vault';

interface Props {
  dirPath: string;
  onClose: () => void;
  onDeleted?: () => void;
}

/// GitHub-style "type the name to delete" confirmation for blowing away a
/// KB and its backing `.db.json` + `index.md`. The user's actual `.md`
/// notes are intentionally preserved — the backend leaves them alone.
export function KbDeleteConfirm({ dirPath, onClose, onDeleted }: Props) {
  const basename = dirPath.split('/').filter(Boolean).pop() ?? dirPath;
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { refreshTree } = useVaultStore();

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const matches = value.trim() === basename;

  async function handleDelete() {
    if (!matches || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await invoke('kb_delete', { dirPath, confirmName: value.trim() });
      await refreshTree();
      onDeleted?.();
      onClose();
    } catch (e) {
      setError(String(e));
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
    >
      <div
        className="w-[440px] max-w-[92vw] rounded-lg border border-border bg-surface-0 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="flex items-center gap-2 text-error">
            <AlertTriangle size={16} />
            <span className="font-medium">Удалить базу данных</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-surface-hover text-text-muted"
          >
            <X size={14} />
          </button>
        </div>

        <div className="px-4 py-4 space-y-3 text-sm text-text-secondary">
          <p>
            Это удалит{' '}
            <code className="px-1 rounded bg-surface-1 text-text-primary">
              {dirPath}.db.json
            </code>{' '}
            и{' '}
            <code className="px-1 rounded bg-surface-1 text-text-primary">
              {dirPath}/index.md
            </code>
            . Ваши{' '}
            <span className="text-text-primary">.md</span> файлы внутри папки
            останутся на диске.
          </p>
          <p className="text-text-muted">
            Чтобы подтвердить, введите{' '}
            <code className="px-1 rounded bg-surface-1 text-text-primary">
              {basename}
            </code>
            :
          </p>
          <input
            ref={inputRef}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleDelete();
            }}
            placeholder={basename}
            className="w-full px-2 py-1.5 rounded border border-border bg-surface-1 text-text-primary outline-none focus:border-accent"
          />
          {error && <p className="text-error text-xs">{error}</p>}
        </div>

        <div className="flex justify-end gap-2 px-4 py-3 border-t border-border">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded text-sm text-text-secondary hover:bg-surface-hover"
          >
            Отмена
          </button>
          <button
            onClick={handleDelete}
            disabled={!matches || submitting}
            className="px-3 py-1.5 rounded text-sm bg-error text-white disabled:opacity-40 disabled:cursor-not-allowed hover:bg-error/90"
          >
            {submitting ? 'Удаляю…' : 'Удалить базу данных'}
          </button>
        </div>
      </div>
    </div>
  );
}
