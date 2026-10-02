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

/** Settings → Notes: where daily notes and templates live. */
export function NotesSettings() {
  const templatesFolder = useUIStore((s) => s.templatesFolder);
  const setTemplatesFolder = useUIStore((s) => s.setTemplatesFolder);
  const dailyFolder = useUIStore((s) => s.dailyFolder);
  const setDailyFolder = useUIStore((s) => s.setDailyFolder);
  const dailyTemplate = useUIStore((s) => s.dailyTemplate);
  const setDailyTemplate = useUIStore((s) => s.setDailyTemplate);

  return (
    <div className="flex flex-col gap-5">
      <FolderField
        id="daily-folder"
        label="Daily notes folder"
        description="“Open today's daily note” creates YYYY-MM-DD.md here."
        value={dailyFolder}
        fallback="daily"
        onCommit={setDailyFolder}
      />
      <div className="flex flex-col gap-1">
        <label htmlFor="daily-template" className="text-sm text-text-primary">
          Daily note template
        </label>
        <input
          id="daily-template"
          value={dailyTemplate}
          onChange={(e) => setDailyTemplate(e.target.value)}
          placeholder={`${templatesFolder}/daily.md`}
          className="px-2 py-1 text-sm rounded border border-border bg-surface-0 text-text-primary outline-none focus:border-accent"
        />
        <p className="text-xs text-text-muted">
          Path of a template (inside the templates folder) that new daily notes start from. Leave empty to use a template named
          “daily” in the templates folder, if there is one; otherwise the note starts blank.
        </p>
      </div>
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
