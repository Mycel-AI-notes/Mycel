import { FileText, Plus } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { useVaultStore } from '@/stores/vault';
import { dbApi } from '@/lib/database/api';
import type { Row } from '@/types/database';
import { useAnchorPos, useClickOutside } from '../floating';

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
  const anchorRef = useRef<HTMLSpanElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const pos = useAnchorPos(anchorRef, creating);
  useClickOutside([anchorRef, popRef], creating, () => setCreating(false));

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
          void openNote(row.page!, { preview: true });
        }}
      >
        <FileText size={12} /> {stem}
      </button>
    );
  }

  return (
    <>
      <span ref={anchorRef} className="db-cell-anchor">
        <button
          className="db-pagelink-create"
          onClick={(e) => {
            e.stopPropagation();
            setCreating(true);
          }}
        >
          <Plus size={12} /> Create page
        </button>
      </span>
      {creating &&
        pos &&
        createPortal(
          <div
            ref={popRef}
            className="db-popover db-cell-popover"
            style={{
              position: 'fixed',
              top: pos.top,
              left: pos.left,
              minWidth: Math.max(240, pos.minWidth),
              zIndex: 60,
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
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
                  const dir = pagesDir ?? '';
                  const notePath = (dir ? dir + '/' : '') + name + '.md';
                  try {
                    await dbApi.createPage(dbPath, row.id, notePath);
                    setCreating(false);
                    onChanged();
                    await refreshTree();
                  } catch (err) {
                    console.error(err);
                    alert(String(err));
                  }
                }
              }}
            />
            {pagesDir && (
              <div className="db-pagelink-hint">
                Will be saved in <code>{pagesDir}/</code>
              </div>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
