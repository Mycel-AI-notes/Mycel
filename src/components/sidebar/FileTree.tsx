import { useState, useCallback, useRef, useEffect } from 'react';
import type { DragEvent as ReactDragEvent } from 'react';
import {
  ChevronRight,
  ChevronDown,
  FileText,
  Folder,
  FolderOpen,
  FilePlus,
  FolderPlus,
  Trash2,
  Pencil,
  Library,
  Zap,
  Lock,
  LockOpen,
} from 'lucide-react';
import { clsx } from 'clsx';
import { confirm } from '@tauri-apps/plugin-dialog';
import type { FileEntry } from '@/types';
import { useVaultStore } from '@/stores/vault';
import { useCryptoStore } from '@/stores/crypto';
import { stripNoteExt } from '@/lib/note-name';

const DRAG_MIME = 'application/x-mycel-path';

type CreatingType = 'note' | 'folder';
interface CreatingState {
  type: CreatingType;
  parent: string; // '' = vault root
}

function parentOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

function joinPath(parent: string, name: string): string {
  return parent ? `${parent}/${name}` : name;
}

interface NodeProps {
  entry: FileEntry;
  depth: number;
  expanded: Set<string>;
  setExpanded: React.Dispatch<React.SetStateAction<Set<string>>>;
  creating: CreatingState | null;
  newName: string;
  setNewName: (v: string) => void;
  startCreate: (type: CreatingType, parent: string) => void;
  commitCreate: () => void;
  cancelCreate: () => void;
  inputRef: React.RefObject<HTMLInputElement | null>;
}

function FileTreeNode({
  entry,
  depth,
  expanded,
  setExpanded,
  creating,
  newName,
  setNewName,
  startCreate,
  commitCreate,
  cancelCreate,
  inputRef,
}: NodeProps) {
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const [isDragOver, setIsDragOver] = useState(false);
  const { openNote, deleteNote, renameNote, pinTab, activeTabPath } = useVaultStore();
  const { status: cryptoStatus, encryptNote, decryptNote } = useCryptoStore();

  const isActive = activeTabPath === entry.path;
  const isKB = !!entry.is_knowledge_base;
  const isQuickRoot = !!entry.is_quick_notes;
  const isLocked = isKB || isQuickRoot;
  const isOpen = entry.is_dir && expanded.has(entry.path);
  const isEnc = !!entry.is_encrypted;

  const toggleExpand = useCallback(() => {
    setExpanded((s) => {
      const next = new Set(s);
      if (next.has(entry.path)) next.delete(entry.path);
      else next.add(entry.path);
      return next;
    });
  }, [entry.path, setExpanded]);

  const handleClick = useCallback(() => {
    if (entry.is_dir) {
      toggleExpand();
    } else {
      openNote(entry.path, { preview: true });
    }
  }, [entry, openNote, toggleExpand]);

  const handleDoubleClick = useCallback(() => {
    if (!entry.is_dir) {
      pinTab(entry.path);
    }
  }, [entry, pinTab]);

  const handleDelete = useCallback(
    async (e: React.MouseEvent) => {
      e.stopPropagation();
      const ok = await confirm(`Delete "${entry.name}"?`, { title: 'Delete', kind: 'warning' });
      if (ok) deleteNote(entry.path);
    },
    [entry, deleteNote],
  );

  const startRename = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      setRenameValue(entry.is_dir ? entry.name : stripNoteExt(entry.name));
      setRenaming(true);
    },
    [entry],
  );

  const commitRename = useCallback(() => {
    const trimmed = renameValue.trim();
    const original = entry.is_dir ? entry.name : stripNoteExt(entry.name);
    if (trimmed && trimmed !== original) {
      const dir = parentOf(entry.path);
      const ext = entry.is_dir ? '' : isEnc ? '.md.age' : '.md';
      const base = stripNoteExt(trimmed);
      const newPath = joinPath(dir, `${base}${ext}`);
      renameNote(entry.path, newPath);
    }
    setRenaming(false);
  }, [renameValue, entry, renameNote, isEnc]);

  const handleDragStart = useCallback(
    (e: ReactDragEvent) => {
      if (isLocked || renaming) {
        e.preventDefault();
        return;
      }
      e.dataTransfer.setData(DRAG_MIME, entry.path);
      e.dataTransfer.setData('text/plain', entry.path);
      e.dataTransfer.effectAllowed = 'move';
    },
    [entry.path, isLocked, renaming],
  );

  const handleDragOver = useCallback(
    (e: ReactDragEvent) => {
      if (!entry.is_dir) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      setIsDragOver(true);
    },
    [entry.is_dir],
  );

  const handleDragLeave = useCallback((e: ReactDragEvent) => {
    // Avoid flicker when the pointer moves into a child element.
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: ReactDragEvent) => {
      if (!entry.is_dir) return;
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      const src =
        e.dataTransfer.getData(DRAG_MIME) || e.dataTransfer.getData('text/plain');
      if (!src) return;
      if (src === entry.path) return;
      if (entry.path.startsWith(src + '/')) return; // cannot move into own descendant
      if (parentOf(src) === entry.path) return; // already inside
      const name = src.split('/').pop()!;
      renameNote(src, joinPath(entry.path, name));
      setExpanded((s) => new Set(s).add(entry.path));
    },
    [entry, renameNote, setExpanded],
  );

  return (
    <div>
      <div
        draggable={!renaming && !isLocked}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={clsx(
          'group flex items-center gap-1 px-2 py-0.5 rounded cursor-pointer text-sm select-none transition-colors',
          'hover:bg-surface-hover',
          isActive && 'bg-accent/12 text-accent',
          !isActive && 'text-text-secondary',
          isDragOver && entry.is_dir && 'bg-accent/15 ring-1 ring-accent/40',
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
      >
        {entry.is_dir ? (
          <>
            <span className="w-3 h-3 shrink-0 text-text-muted">
              {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
            </span>
            {isKB ? (
              <Library size={14} className="shrink-0 text-accent" />
            ) : isQuickRoot ? (
              <Zap
                size={14}
                className="shrink-0 text-accent"
                fill="currentColor"
                strokeWidth={1.5}
              />
            ) : isOpen ? (
              <FolderOpen size={14} className="shrink-0 text-accent-muted/90" />
            ) : (
              <Folder size={14} className="shrink-0 text-accent-deep" />
            )}
          </>
        ) : (
          <>
            <span className="w-3 h-3 shrink-0" />
            {isEnc ? (
              <Lock size={14} className="shrink-0 text-accent" />
            ) : (
              <FileText size={14} className="shrink-0 text-text-muted" />
            )}
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
          <span className="flex-1 truncate">
            {entry.is_dir ? entry.name : stripNoteExt(entry.name)}
          </span>
        )}

        {!renaming && !isLocked && (
          <span className="hidden group-hover:flex items-center gap-0.5">
            {entry.is_dir && (
              <>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpanded((s) => new Set(s).add(entry.path));
                    startCreate('note', entry.path);
                  }}
                  className="p-0.5 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary"
                  title="New note in folder"
                >
                  <FilePlus size={11} />
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setExpanded((s) => new Set(s).add(entry.path));
                    startCreate('folder', entry.path);
                  }}
                  className="p-0.5 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary"
                  title="New folder in folder"
                >
                  <FolderPlus size={11} />
                </button>
              </>
            )}
            {!entry.is_dir && cryptoStatus?.configured && (
              <button
                onClick={async (e) => {
                  e.stopPropagation();
                  try {
                    if (isEnc) {
                      if (!cryptoStatus.unlocked) {
                        // Pop the unlock prompt automatically. If the
                        // user cancels, bail without warning — they
                        // explicitly declined to proceed.
                        try {
                          await useCryptoStore.getState().requireUnlock();
                        } catch {
                          return;
                        }
                      }
                      // Decrypt = file goes back to plaintext on disk.
                      // Subsequent saves and the next sync will push it
                      // unencrypted. Make the user confirm.
                      const stem = entry.name.replace(/\.md\.age$/, '');
                      const ok = await confirm(
                        'This note will be written to disk as plaintext from now on, and the next sync will push it unencrypted to GitHub. The current encrypted blob is being replaced. Continue?',
                        { title: `Decrypt "${stem}"?`, kind: 'warning' },
                      );
                      if (!ok) return;
                      const newPath = await decryptNote(entry.path);
                      await useVaultStore.getState().relocateNote(entry.path, newPath);
                    } else {
                      // Warn before encrypting an existing plaintext
                      // note. Only skip the warning if the body is
                      // literally untouched — empty or just the
                      // auto-generated heading. Anything else (even
                      // five characters the user typed) might already
                      // have been auto-saved, indexed, swapped out, or
                      // synced as plaintext, and encrypting now does
                      // not retroactively scrub that.
                      const cached = useVaultStore.getState().noteCache.get(entry.path);
                      const trimmed = (cached?.content ?? '').trim();
                      const stem = entry.name.replace(/\.md$/, '');
                      const isUntouched =
                        trimmed === '' || trimmed === `# ${stem}`;
                      if (!isUntouched) {
                        const ok = await confirm(
                          'Anything you have already typed in this note may have been auto-saved to disk, synced to GitHub, or paged into swap. Encrypting now only protects FUTURE writes — the earlier content is NOT scrubbed. Continue?',
                          { title: `Encrypt "${stem}"?`, kind: 'warning' },
                        );
                        if (!ok) return;
                      }
                      const newPath = await encryptNote(entry.path);
                      await useVaultStore.getState().relocateNote(entry.path, newPath);
                    }
                  } catch (err) {
                    console.error(err);
                  }
                }}
                className="p-0.5 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary"
                title={isEnc ? 'Decrypt note' : 'Encrypt note'}
              >
                {isEnc ? <LockOpen size={11} /> : <Lock size={11} />}
              </button>
            )}
            <button
              onClick={startRename}
              className="p-0.5 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary"
              title="Rename"
            >
              <Pencil size={11} />
            </button>
            <button
              onClick={handleDelete}
              className="p-0.5 rounded hover:bg-error/15 text-text-muted hover:text-error"
              title="Delete"
            >
              <Trash2 size={11} />
            </button>
          </span>
        )}
      </div>

      {entry.is_dir && isOpen && (
        <div>
          {creating && creating.parent === entry.path && (
            <div
              className="py-0.5"
              style={{ paddingLeft: `${(depth + 1) * 12 + 24}px`, paddingRight: '8px' }}
            >
              <input
                ref={inputRef}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onBlur={commitCreate}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitCreate();
                  if (e.key === 'Escape') cancelCreate();
                }}
                placeholder={creating.type === 'note' ? 'Note name…' : 'Folder name…'}
                className="w-full bg-surface-0 border border-accent rounded px-1 py-0.5 text-sm text-text-primary outline-none"
              />
            </div>
          )}
          {entry.children?.map((child) => (
            <FileTreeNode
              key={child.path}
              entry={child}
              depth={depth + 1}
              expanded={expanded}
              setExpanded={setExpanded}
              creating={creating}
              newName={newName}
              setNewName={setNewName}
              startCreate={startCreate}
              commitCreate={commitCreate}
              cancelCreate={cancelCreate}
              inputRef={inputRef}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileTree() {
  const { fileTree, vaultRoot, createNote, createFolder, renameNote, activeTabPath } =
    useVaultStore();
  const [creating, setCreating] = useState<CreatingState | null>(null);
  const [newName, setNewName] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [rootDragOver, setRootDragOver] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const initializedRef = useRef(false);

  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  // Expand top-level folders on first load so the tree isn't completely collapsed.
  useEffect(() => {
    if (initializedRef.current) return;
    if (fileTree.length === 0) return;
    initializedRef.current = true;
    setExpanded((prev) => {
      const next = new Set(prev);
      fileTree.forEach((e) => {
        if (e.is_dir) next.add(e.path);
      });
      return next;
    });
  }, [fileTree]);

  // Whenever the user opens a note (file tree click, quick switcher, palette,
  // or Garden's "Create page"), expand every ancestor folder so the file is
  // visible in the tree. Without this, freshly-created notes inside a
  // collapsed folder stay invisible until the user manually expands. Skip
  // synthetic garden tab paths — they don't map to disk.
  useEffect(() => {
    if (!activeTabPath) return;
    if (activeTabPath.startsWith('garden:')) return;
    const parts = activeTabPath.split('/');
    if (parts.length <= 1) return;
    const ancestors: string[] = [];
    for (let i = 1; i < parts.length; i += 1) {
      ancestors.push(parts.slice(0, i).join('/'));
    }
    setExpanded((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const p of ancestors) {
        if (!next.has(p)) {
          next.add(p);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [activeTabPath]);

  const startCreate = useCallback((type: CreatingType, parent: string) => {
    setNewName('');
    setCreating({ type, parent });
  }, []);

  const commitCreate = useCallback(async () => {
    const trimmed = newName.trim();
    const state = creating;
    setCreating(null);
    setNewName('');
    if (!trimmed || !state) return;
    try {
      if (state.type === 'note') {
        const name = `${trimmed.replace(/\.md$/, '')}.md`;
        await createNote(joinPath(state.parent, name));
      } else {
        await createFolder(joinPath(state.parent, trimmed));
      }
    } catch (e) {
      console.error(e);
    }
  }, [newName, creating, createNote, createFolder]);

  const cancelCreate = useCallback(() => {
    setCreating(null);
    setNewName('');
  }, []);

  const handleRootDragOver = useCallback((e: ReactDragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setRootDragOver(true);
  }, []);

  const handleRootDragLeave = useCallback((e: ReactDragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setRootDragOver(false);
  }, []);

  const handleRootDrop = useCallback(
    (e: ReactDragEvent) => {
      e.preventDefault();
      setRootDragOver(false);
      const src =
        e.dataTransfer.getData(DRAG_MIME) || e.dataTransfer.getData('text/plain');
      if (!src) return;
      if (parentOf(src) === '') return; // already at vault root
      const name = src.split('/').pop()!;
      renameNote(src, name);
    },
    [renameNote],
  );

  if (!vaultRoot) return null;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-xs font-semibold uppercase tracking-wider text-text-muted">
          Files
        </span>
        <div className="flex items-center gap-0.5">
          <button
            onClick={() => startCreate('note', '')}
            className="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary"
            title="New note"
          >
            <FilePlus size={14} />
          </button>
          <button
            onClick={() => startCreate('folder', '')}
            className="p-1 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary"
            title="New folder"
          >
            <FolderPlus size={14} />
          </button>
        </div>
      </div>

      <div
        className={clsx(
          'flex-1 overflow-y-auto py-1 transition-colors',
          rootDragOver && 'bg-accent/5',
        )}
        onDragOver={handleRootDragOver}
        onDragLeave={handleRootDragLeave}
        onDrop={handleRootDrop}
      >
        {creating && creating.parent === '' && (
          <div className="py-0.5" style={{ paddingLeft: '24px', paddingRight: '8px' }}>
            <input
              ref={inputRef}
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onBlur={commitCreate}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitCreate();
                if (e.key === 'Escape') cancelCreate();
              }}
              placeholder={creating.type === 'note' ? 'Note name…' : 'Folder name…'}
              className="w-full bg-surface-0 border border-accent rounded px-1 py-0.5 text-sm text-text-primary outline-none"
            />
          </div>
        )}
        {fileTree.map((entry) => (
          <FileTreeNode
            key={entry.path}
            entry={entry}
            depth={0}
            expanded={expanded}
            setExpanded={setExpanded}
            creating={creating}
            newName={newName}
            setNewName={setNewName}
            startCreate={startCreate}
            commitCreate={commitCreate}
            cancelCreate={cancelCreate}
            inputRef={inputRef}
          />
        ))}
        {fileTree.length === 0 && !creating && (
          <p className="text-text-muted text-xs px-3 py-4">No notes yet. Click + to create one.</p>
        )}
      </div>
    </div>
  );
}
