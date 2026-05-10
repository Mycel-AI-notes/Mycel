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
  const { openNote, refreshTree } = useVaultStore();
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
          // Pages opened from the table start as preview tabs — they only
          // get pinned when the user actually saves them.
          void openNote(row.page!, { preview: true });
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
                // Refresh sidebar so the new folder/file is visible. Don't
                // open the page automatically — user keeps focus on the
                // table and can click the page link if they want to edit.
                await refreshTree();
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
