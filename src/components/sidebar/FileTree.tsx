import { useState, useCallback, useRef, useEffect } from 'react';
import { ChevronRight, ChevronDown, FileText, Folder, FolderOpen, Plus, Trash2, Pencil } from 'lucide-react';
import { clsx } from 'clsx';
import { confirm } from '@tauri-apps/plugin-dialog';
import type { FileEntry } from '@/types';
import { useVaultStore } from '@/stores/vault';

interface FileTreeNodeProps {
  entry: FileEntry;
  depth: number;
}

function FileTreeNode({ entry, depth }: FileTreeNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const { openNote, deleteNote, renameNote, activeTabPath } = useVaultStore();

  const isActive = activeTabPath === entry.path;

  const handleClick = useCallback(() => {
    if (entry.is_dir) {
      setExpanded((e) => !e);
    } else {
      openNote(entry.path);
    }
  }, [entry, openNote]);

  const handleDelete = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      const ok = await confirm(`Delete "${entry.name}"?`, { title: 'Delete note', kind: 'warning' });
      if (ok) deleteNote(entry.path);
    },
    [entry, deleteNote],
  );

  const startRename = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setRenameValue(entry.name.replace(/\.md$/, ''));
      setRenaming(true);
    },
    [entry.name],
  );

  const commitRename = useCallback(() => {
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== entry.name.replace(/\.md$/, '')) {
      const dir = entry.path.split('/').slice(0, -1).join('/');
      const newPath = dir ? `${dir}/${trimmed}.md` : `${trimmed}.md`;
      renameNote(entry.path, newPath);
    }
    setRenaming(false);
  }, [renameValue, entry, renameNote]);

  return (
    <div>
      <div
        className={clsx(
          'group flex items-center gap-1 px-2 py-0.5 rounded cursor-pointer text-sm select-none',
          'hover:bg-white/8 dark:hover:bg-white/5',
          isActive && 'bg-accent/15 text-accent',
          !isActive && 'text-text-secondary',
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={handleClick}
      >
        {entry.is_dir ? (
          <>
            <span className="w-3 h-3 shrink-0 text-text-muted">
              {expanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </span>
            {expanded ? (
              <FolderOpen size={14} className="shrink-0 text-yellow-500/80" />
            ) : (
              <Folder size={14} className="shrink-0 text-yellow-500/80" />
            )}
          </>
        ) : (
          <>
            <span className="w-3 h-3 shrink-0" />
            <FileText size={14} className="shrink-0 text-text-muted" />
          </>
        )}

        {renaming ? (
          <input
            autoFocus
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename();
              if (e.key === 'Escape') setRenaming(false);
            }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 bg-surface-0 border border-accent rounded px-1 text-text-primary outline-none text-sm"
          />
        ) : (
          <span className="flex-1 truncate">{entry.name.replace(/\.md$/, '')}</span>
        )}

        {!entry.is_dir && !renaming && (
          <span className="hidden group-hover:flex items-center gap-0.5">
            <button
              onClick={startRename}
              className="p-0.5 rounded hover:bg-white/10 text-text-muted hover:text-text-primary"
            >
              <Pencil size={11} />
            </button>
            <button
              onClick={handleDelete}
              className="p-0.5 rounded hover:bg-red-500/20 text-text-muted hover:text-red-400"
            >
              <Trash2 size={11} />
            </button>
          </span>
        )}
      </div>

      {entry.is_dir && expanded && entry.children && (
        <div>
          {entry.children.map((child) => (
            <FileTreeNode key={child.path} entry={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTree() {
  const { fileTree, vaultRoot, createNote } = useVaultStore();
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  const startCreate = useCallback(() => {
    setNewName('');
    setCreating(true);
  }, []);

  const commitCreate = useCallback(async () => {
    const trimmed = newName.trim();
    setCreating(false);
    if (!trimmed) return;
    const path = `${trimmed.replace(/\.md$/, '')}.md`;
    try {
      await createNote(path);
    } catch (e) {
      console.error(e);
    }
  }, [newName, createNote]);

  const cancelCreate = useCallback(() => {
    setCreating(false);
    setNewName('');
  }, []);

  if (!vaultRoot) return null;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          Files
        </span>
        <button
          onClick={startCreate}
          className="p-1 rounded hover:bg-white/10 text-text-muted hover:text-text-primary"
          title="New note"
        >
          <Plus size={14} />
        </button>
      </div>

      {creating && (
        <div className="px-3 py-1.5 border-b border-border">
          <input
            ref={inputRef}
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            onBlur={commitCreate}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitCreate();
              if (e.key === 'Escape') cancelCreate();
            }}
            placeholder="Note name…"
            className="w-full bg-surface-0 border border-accent rounded px-2 py-0.5 text-sm text-text-primary outline-none"
          />
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-1">
        {fileTree.map((entry) => (
          <FileTreeNode key={entry.path} entry={entry} depth={0} />
        ))}
        {fileTree.length === 0 && !creating && (
          <p className="text-text-muted text-xs px-3 py-4">No notes yet. Click + to create one.</p>
        )}
      </div>
    </div>
  );
}
