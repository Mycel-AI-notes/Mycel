import { useEffect, useState } from 'react';
import { useUIStore } from '@/stores/ui';
import { normalizeFolder } from '@/lib/templates';

interface FolderFieldProps {
  id: string;
  label: string;
  description: string;
  value: string;
  fallback: string;
  onCommit: (folder: string) => void;
}

/**
 * A vault-relative folder input. Commits on blur or Enter, and only a folder
 * that `normalizeFolder` accepts — anything that could point outside the
 * vault is refused with a message instead of being saved.
 */
function FolderField({ id, label, description, value, fallback, onCommit }: FolderFieldProps) {
  const [draft, setDraft] = useState(value);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setDraft(value), [value]);

  const commit = () => {
    if (!draft.trim()) {
      setError(null);
      onCommit(fallback);
      return;
    }
    const folder = normalizeFolder(draft);
    if (!folder) {
      setError('Use a plain folder path inside the vault, e.g. "meta/templates".');
      return;
    }
    setError(null);
    onCommit(folder);
  };

  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm text-text-primary">
        {label}
      </label>
      <input
        id={id}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
        }}
        placeholder={fallback}
        className="px-2 py-1 text-sm rounded border border-border bg-surface-0 text-text-primary outline-none focus:border-accent"
      />
      <p className="text-xs text-text-muted">{description}</p>
      {error && <p className="text-xs text-error">{error}</p>}
    </div>
  );
}

/** Settings → Notes: where templates (and daily notes) live. */
export function NotesSettings() {
  const templatesFolder = useUIStore((s) => s.templatesFolder);
  const setTemplatesFolder = useUIStore((s) => s.setTemplatesFolder);

  return (
    <div className="flex flex-col gap-5">
      <FolderField
        id="templates-folder"
        label="Templates folder"
        description="Every .md file here is offered by “Insert template…” and /template. Variables: {{title}}, {{date}}, {{time}}, {{date:YYYY-MM-DD HH:mm}}."
        value={templatesFolder}
        fallback="templates"
        onCommit={setTemplatesFolder}
      />
    </div>
  );
}
