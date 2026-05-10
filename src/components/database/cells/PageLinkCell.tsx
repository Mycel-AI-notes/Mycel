import { FileText, Plus } from 'lucide-react';
import { useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useVaultStore } from '@/stores/vault';
import { dbApi } from '@/lib/database/api';
import type { Row } from '@/types/database';

interface Props {
  dbPath: string;
  row: Row;
  onChanged: () => void;
}

function sanitizeName(name: string): string {
  return name.trim().replace(/[\\/:*?"<>|]/g, '-');
}

export function PageLinkCell({ dbPath, row, onChanged }: Props) {
  const { openNote } = useVaultStore();
  const [creating, setCreating] = useState(false);
  const [pagesDir, setPagesDir] = useState<string | null>(null);
  const [draft, setDraft] = useState(() => {
    const t = (row['title'] as string) ?? '';
    return t.trim();
  });

  useEffect(() => {
    if (!creating || pagesDir !== null) return;
    void invoke<string>('db_pages_dir', { path: dbPath })
      .then((d) => setPagesDir(d))
      .catch(() => setPagesDir(''));
  }, [creating, dbPath, pagesDir]);

  if (row.page) {
    const stem = row.page.split('/').pop()?.replace(/\.md$/, '') ?? row.page;
    return (
      <button
        className="db-pagelink"
        onClick={(e) => {
          e.stopPropagation();
          void openNote(row.page!);
        }}
      >
        <FileText size={12} /> {stem}
      </button>
    );
  }

  if (creating) {
    const dir = pagesDir ?? '';
    return (
      <div className="db-popover" style={{ minWidth: 240 }}>
        <input
          autoFocus
          className="db-popover-input"
          value={draft}
          placeholder="page-name"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={async (e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              setCreating(false);
              return;
            }
            if (e.key === 'Enter') {
              e.preventDefault();
              const name = sanitizeName(draft);
              if (!name) return;
              const notePath = (dir ? dir + '/' : '') + name + '.md';
              try {
                await dbApi.createPage(dbPath, row.id, notePath);
                setCreating(false);
                onChanged();
                await openNote(notePath);
              } catch (err) {
                console.error(err);
                alert(String(err));
              }
            }
          }}
          onBlur={() => setCreating(false)}
        />
        {dir && (
          <div className="db-pagelink-hint">
            Will be saved in <code>{dir}/</code>
          </div>
        )}
      </div>
    );
  }

  return (
    <button
      className="db-pagelink-create"
      onClick={(e) => {
        e.stopPropagation();
        setCreating(true);
      }}
    >
      <Plus size={12} /> Create page
    </button>
  );
}
