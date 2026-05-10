import { ReactNode, useEffect, useRef, useState } from 'react';
import { useVaultStore } from '@/stores/vault';

interface Props {
  value: string;
  editing: boolean;
  onChange: (next: string) => void;
  onCommit: () => void;
}

function renderRichText(text: string, openNote: (path: string) => Promise<string | null>) {
  const re = /\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g;
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let key = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    const target = m[1].trim();
    const label = (m[2] ?? m[1]).trim();
    out.push(
      <a
        key={key++}
        className="db-wikilink"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          void openNote(target);
        }}
      >
        {label}
      </a>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function RichTextCell({ value, editing, onChange, onCommit }: Props) {
  const ref = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value ?? '');
  const { openNote, createNote } = useVaultStore();

  useEffect(() => {
    if (editing) {
      setDraft(value ?? '');
      requestAnimationFrame(() => ref.current?.focus());
    }
  }, [editing, value]);

  async function resolveAndOpen(target: string): Promise<string | null> {
    const stem = target.toLowerCase();
    const notes = await import('@tauri-apps/api/core').then((m) =>
      m.invoke<{ path: string; title: string }[]>('notes_list'),
    );
    const found =
      notes.find((n) => n.path.split('/').pop()?.replace(/\.md$/, '').toLowerCase() === stem) ??
      notes.find((n) => n.title.toLowerCase() === stem);
    if (found) {
      await openNote(found.path);
      return found.path;
    }
    await createNote(`${target}.md`);
    return null;
  }

  if (!editing) {
    return <span className="db-cell-rich">{renderRichText(value ?? '', resolveAndOpen)}</span>;
  }

  return (
    <input
      ref={ref}
      type="text"
      className="db-cell-input"
      value={draft}
      placeholder="Plain text or [[wikilinks]]"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        onChange(draft);
        onCommit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onChange(draft);
          onCommit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCommit();
        }
      }}
    />
  );
}
