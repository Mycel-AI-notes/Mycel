import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
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
  Database as DatabaseIcon,
} from 'lucide-react';
import { clsx } from 'clsx';
import { confirm } from '@tauri-apps/plugin-dialog';
import type { FileEntry } from '@/types';
import { KNOWLEDGE_BASE_DIR, QUICK_NOTES_DIR } from '@/types';
import { useVaultStore } from '@/stores/vault';
import { useCryptoStore } from '@/stores/crypto';
import { useCustomOrder, orderTree } from '@/stores/customOrder';
import { stripNoteExt, isAttachmentPath } from '@/lib/note-name';
import { KbContextMenu } from '@/components/kb/KbContextMenu';

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

// Flatten visible (expanded) entries in display order so keyboard nav can
// move "up/down one row" without re-walking the tree at every keypress.
function flattenVisible(tree: FileEntry[], expanded: Set<string>): FileEntry[] {
  const out: FileEntry[] = [];
  const walk = (entries: FileEntry[]) => {
    for (const e of entries) {
      out.push(e);
      if (e.is_dir && expanded.has(e.path) && e.children) walk(e.children);
    }
  };
  walk(tree);
  return out;
}

type DropZone = 'above' | 'into' | 'below';
interface DropTarget {
  path: string;
  zone: DropZone;
}

interface NodeProps {
  entry: FileEntry;
  siblings: FileEntry[];
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
  openKbMenu: (x: number, y: number, entry: FileEntry) => void;
  focusedPath: string | null;
  tabbablePath: string | null;
  autoFocusPath: string | null;
  setFocusedPath: (p: string | null) => void;
  setAutoFocusPath: (p: string | null) => void;
  draggingPath: string | null;
  setDraggingPath: (p: string | null) => void;
  dropTarget: DropTarget | null;
  setDropTarget: (t: DropTarget | null) => void;
  renameRequest: string | null;
  clearRenameRequest: () => void;
  onRowKeyDown: (e: React.KeyboardEvent, entry: FileEntry) => void;
}

function FileTreeNode({
  entry,
  siblings,
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
  openKbMenu,
  focusedPath,
  tabbablePath,
  autoFocusPath,
  setFocusedPath,
  setAutoFocusPath,
  draggingPath,
  setDraggingPath,
  dropTarget,
  setDropTarget,
  renameRequest,
  clearRenameRequest,
  onRowKeyDown,
}: NodeProps) {
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const isDragging = draggingPath === entry.path;
  const dropZone = dropTarget?.path === entry.path ? dropTarget.zone : null;
  const { openNote, deleteNote, renameNote, pinTab, activeTabPath } = useVaultStore();
  const { status: cryptoStatus, encryptNote, decryptNote } = useCryptoStore();
  const rowRef = useRef<HTMLDivElement>(null);
  const isFocused = focusedPath === entry.path;
  const isTabbable = tabbablePath === entry.path;

  const isActive = activeTabPath === entry.path;
  const isKB = !!entry.is_knowledge_base;
  const isKbDir = !!entry.is_kb_dir;
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

  const { openImageTab } = useVaultStore();

  const handleClick = useCallback(() => {
    if (entry.is_dir) {
      // KB-promoted folders open their index.md on plain click AND toggle
      // the tree so the user sees the folder's contents alongside the note.
      if (isKbDir) {
        openNote(`${entry.path}/index.md`, { preview: true });
        toggleExpand();
      } else {
        toggleExpand();
      }
      return;
    }
    if (isAttachmentPath(entry.path)) {
      // Attachments aren't notes — render them in the image tab view
      // instead of routing through the markdown reader, which would
      // choke on binary bytes.
      openImageTab(entry.path, { preview: true });
      return;
    }
    openNote(entry.path, { preview: true });
  }, [entry, isKbDir, openNote, openImageTab, toggleExpand]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      // KB context menu is folder-only and only suppresses the WebView's
      // default menu for those folders. Files keep the native menu so users
      // still get "Inspect Element" while debugging.
      if (!entry.is_dir || isLocked) return;
      // Folders nested inside the protected `Knowledge Base/` (or `quick/`)
      // roots can't be promoted to KBs — that territory already belongs to
      // the database-page mechanism. Fall through to the native menu.
      const insideProtected =
        entry.path.startsWith(`${KNOWLEDGE_BASE_DIR}/`) ||
        entry.path.startsWith(`${QUICK_NOTES_DIR}/`);
      if (insideProtected) return;
      // Descendants of an existing KB have nothing to show in the KB
      // menu: they can't be promoted (only the KB root can), and they
      // aren't a KB themselves. Fall through.
      if (entry.is_inside_kb && !entry.is_kb_dir) return;
      e.preventDefault();
      e.stopPropagation();
      openKbMenu(e.clientX, e.clientY, entry);
    },
    [entry, isLocked, openKbMenu],
  );

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
    (e?: React.MouseEvent) => {
      e?.stopPropagation();
      setRenameValue(entry.is_dir ? entry.name : stripNoteExt(entry.name));
      setRenaming(true);
    },
    [entry],
  );

  // Space-key rename requests come from the parent tree's keyboard handler.
  // We listen for our own path appearing in `renameRequest`, start renaming,
  // then clear the request so it doesn't refire on re-renders.
  useEffect(() => {
    if (renameRequest !== entry.path) return;
    if (renaming) {
      clearRenameRequest();
      return;
    }
    if (isLocked) {
      clearRenameRequest();
      return;
    }
    setRenameValue(entry.is_dir ? entry.name : stripNoteExt(entry.name));
    setRenaming(true);
    clearRenameRequest();
  }, [renameRequest, entry.path, entry.is_dir, entry.name, isLocked, renaming, clearRenameRequest]);

  // Only move browser focus when arrow-key navigation explicitly asks us to
  // (via autoFocusPath). Clicking a row sets focusedPath but should *not*
  // steal focus from the editor.
  useEffect(() => {
    if (autoFocusPath === entry.path && !renaming && rowRef.current) {
      const active = document.activeElement;
      if (active !== rowRef.current) {
        rowRef.current.focus({ preventScroll: false });
      }
    }
  }, [autoFocusPath, entry.path, renaming]);

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
      if (renaming) {
        e.preventDefault();
        return;
      }
      // Protected roots (KB / Quick) can still be dragged so the user can
      // reorder them among root entries, but `handleDrop` refuses any move
      // that would change their parent — the backend rejects renames of
      // these paths anyway.
      e.dataTransfer.setData(DRAG_MIME, entry.path);
      e.dataTransfer.setData('text/plain', entry.path);
      e.dataTransfer.effectAllowed = 'move';
      setDraggingPath(entry.path);
    },
    [entry.path, renaming, setDraggingPath],
  );

  const handleDragEnd = useCallback(() => {
    setDraggingPath(null);
  }, [setDraggingPath]);

  const computeDropZone = useCallback(
    (e: ReactDragEvent): DropZone => {
      const rect = e.currentTarget.getBoundingClientRect();
      const y = e.clientY - rect.top;
      const h = rect.height || 1;
      if (entry.is_dir) {
        // Narrow above/below bands so the bulk of the row commits to "into",
        // which is the common intent when targeting a folder.
        if (y < h * 0.2) return 'above';
        if (y > h * 0.8) return 'below';
        return 'into';
      }
      return y < h * 0.5 ? 'above' : 'below';
    },
    [entry.is_dir],
  );

  const isInvalidTarget =
    !!draggingPath &&
    (entry.path === draggingPath || entry.path.startsWith(draggingPath + '/'));

  const handleDragOver = useCallback(
    (e: ReactDragEvent) => {
      // Reject the source itself / its descendants — can't drop into those.
      if (isInvalidTarget) return;
      e.preventDefault();
      e.stopPropagation();
      e.dataTransfer.dropEffect = 'move';
      // Single shared target: every dragover overwrites it, so there's never
      // more than one highlighted row and nothing to "leak". No dragleave
      // needed — moving onto another row replaces it, leaving the list resets
      // it via the root container's dragover.
      const zone = computeDropZone(e);
      if (dropTarget?.path !== entry.path || dropTarget.zone !== zone) {
        setDropTarget({ path: entry.path, zone });
      }
    },
    [entry.path, computeDropZone, dropTarget, setDropTarget, isInvalidTarget],
  );

  const handleDrop = useCallback(
    (e: ReactDragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const zone = computeDropZone(e);
      setDropTarget(null);
      const src =
        e.dataTransfer.getData(DRAG_MIME) || e.dataTransfer.getData('text/plain');
      if (!src) return;
      if (src === entry.path) return;

      const isInto = zone === 'into' && entry.is_dir;
      const targetDir = isInto ? entry.path : parentOf(entry.path);

      // Cannot move a folder into itself or any of its descendants.
      if (targetDir === src) return;
      if (targetDir.startsWith(src + '/')) return;
      // Protected roots (KB / Quick) cannot be moved into another folder.
      if (
        (src === KNOWLEDGE_BASE_DIR || src === QUICK_NOTES_DIR) &&
        targetDir !== ''
      ) {
        return;
      }

      const srcName = src.split('/').pop()!;
      const targetPath = joinPath(targetDir, srcName);
      const fromParent = parentOf(src);
      const sameParent = fromParent === targetDir;

      // Build the new ordered child-name list for the destination folder.
      const targetChildren = isInto ? (entry.children ?? []) : siblings;
      const baseNames = targetChildren
        .map((c) => c.name)
        .filter((n) => n !== srcName);
      let newOrder: string[];
      if (isInto) {
        newOrder = [...baseNames, srcName];
      } else {
        const idx = baseNames.indexOf(entry.name);
        const insertAt = idx === -1
          ? baseNames.length
          : zone === 'above'
            ? idx
            : idx + 1;
        newOrder = [
          ...baseNames.slice(0, insertAt),
          srcName,
          ...baseNames.slice(insertAt),
        ];
      }

      const { setOrder, renamePath } = useCustomOrder.getState();
      if (!sameParent) {
        renameNote(src, targetPath);
        renamePath(src, targetPath);
      }
      setOrder(targetDir, newOrder);

      // Expand every ancestor of the destination so the moved entry stays
      // visible, and move focus onto it as a visual confirmation that the
      // move happened.
      setExpanded((s) => {
        const next = new Set(s);
        if (isInto) next.add(entry.path);
        const parts = targetPath.split('/');
        for (let i = 1; i < parts.length; i += 1) {
          next.add(parts.slice(0, i).join('/'));
        }
        return next;
      });
      setFocusedPath(targetPath);
      setAutoFocusPath(targetPath);
      setDraggingPath(null);
    },
    [
      entry,
      siblings,
      renameNote,
      setExpanded,
      setFocusedPath,
      setAutoFocusPath,
      setDraggingPath,
      setDropTarget,
      computeDropZone,
    ],
  );

  const anyDragging = !!draggingPath;

  return (
    <div>
      <div className="relative">
        {dropZone === 'above' && (
          <div
            className="pointer-events-none absolute right-2 top-0 h-0.5 bg-accent rounded-full z-10"
            style={{ left: `${depth * 12 + 8}px` }}
          />
        )}
        {dropZone === 'below' && (
          <div
            className="pointer-events-none absolute right-2 bottom-0 h-0.5 bg-accent rounded-full z-10"
            style={{ left: `${depth * 12 + 8}px` }}
          />
        )}
        <div
          ref={rowRef}
          draggable={!renaming}
          tabIndex={isTabbable ? 0 : -1}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragOver={handleDragOver}
          onDrop={handleDrop}
          className={clsx(
            'group flex items-center gap-1 px-2 py-0.5 rounded cursor-pointer text-sm select-none transition-colors outline-none',
            'focus-visible:ring-1 focus-visible:ring-accent/60',
            // Suppress native :hover while dragging — on webkitgtk it keeps
            // firing under the drag cursor and lights up every row passed over.
            !anyDragging && 'hover:bg-surface-hover',
            isActive && 'bg-accent/12 text-accent',
            !isActive && 'text-text-secondary',
            isFocused && !isActive && 'bg-surface-hover',
            dropZone === 'into' && 'bg-accent/20 ring-1 ring-accent',
            isDragging && 'opacity-50 ring-1 ring-accent',
          )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={() => {
          setFocusedPath(entry.path);
          handleClick();
        }}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        onKeyDown={(e) => {
          if (renaming) return;
          onRowKeyDown(e, entry);
        }}
      >
        {entry.is_dir ? (
          <>
            <span
              className="w-3 h-3 shrink-0 text-text-muted cursor-pointer"
              onClick={(e) => {
                // KB folders use the main row click for "open index"; the
                // chevron remains the only way to expand/collapse the tree.
                if (isKbDir) {
                  e.stopPropagation();
                  toggleExpand();
                }
              }}
            >
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
            ) : isKbDir ? (
              <DatabaseIcon size={14} className="shrink-0 text-accent" />
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
      </div>

      {entry.is_dir && isOpen && (
        <div
          onDragOver={(e) => {
            if (isInvalidTarget) return;
            e.preventDefault();
            e.stopPropagation();
            e.dataTransfer.dropEffect = 'move';
            // Empty space inside an expanded folder = "drop into this folder".
            if (dropTarget?.path !== entry.path || dropTarget.zone !== 'into') {
              setDropTarget({ path: entry.path, zone: 'into' });
            }
          }}
          onDrop={(e) => {
            e.preventDefault();
            e.stopPropagation();
            setDropTarget(null);
            const src =
              e.dataTransfer.getData(DRAG_MIME) ||
              e.dataTransfer.getData('text/plain');
            if (!src || src === entry.path) return;
            if (entry.path.startsWith(src + '/')) return;
            if (parentOf(src) === entry.path) return; // already inside
            if (
              (src === KNOWLEDGE_BASE_DIR || src === QUICK_NOTES_DIR) &&
              entry.path !== ''
            ) {
              return;
            }
            const srcName = src.split('/').pop()!;
            const targetPath = joinPath(entry.path, srcName);
            const baseNames = (entry.children ?? [])
              .map((c) => c.name)
              .filter((n) => n !== srcName);
            const { setOrder, renamePath } = useCustomOrder.getState();
            renameNote(src, targetPath);
            renamePath(src, targetPath);
            setOrder(entry.path, [...baseNames, srcName]);
            setExpanded((s) => new Set(s).add(entry.path));
            setFocusedPath(targetPath);
            setAutoFocusPath(targetPath);
            setDraggingPath(null);
          }}
        >
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
              siblings={entry.children ?? []}
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
              openKbMenu={openKbMenu}
              focusedPath={focusedPath}
              tabbablePath={tabbablePath}
              autoFocusPath={autoFocusPath}
              setFocusedPath={setFocusedPath}
              setAutoFocusPath={setAutoFocusPath}
              draggingPath={draggingPath}
              setDraggingPath={setDraggingPath}
              dropTarget={dropTarget}
              setDropTarget={setDropTarget}
              renameRequest={renameRequest}
              clearRenameRequest={clearRenameRequest}
              onRowKeyDown={onRowKeyDown}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface KbMenuState {
  x: number;
  y: number;
  entry: FileEntry;
}

export function FileTree() {
  const { fileTree, vaultRoot, createNote, createFolder, renameNote, activeTabPath } =
    useVaultStore();
  const orderMap = useCustomOrder((s) => s.orderMap);
  const orderedTree = useMemo(
    () => orderTree(fileTree, '', orderMap),
    [fileTree, orderMap],
  );
  const [creating, setCreating] = useState<CreatingState | null>(null);
  const [newName, setNewName] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [kbMenu, setKbMenu] = useState<KbMenuState | null>(null);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const [autoFocusPath, setAutoFocusPath] = useState<string | null>(null);
  const [renameRequest, setRenameRequest] = useState<string | null>(null);
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const initializedRef = useRef(false);

  const clearRenameRequest = useCallback(() => setRenameRequest(null), []);

  // Safety net: clear all drag highlights whenever the tree changes. dragend
  // doesn't fire reliably when the source DOM node unmounts mid-drag, so
  // without this a highlight could stick across drags.
  useEffect(() => {
    setDraggingPath(null);
    setDropTarget(null);
  }, [fileTree]);

  // A single bubbling dragend resets every highlight, even when the drag is
  // cancelled (Esc) or dropped outside any row.
  const handleDragEndCapture = useCallback(() => {
    setDraggingPath(null);
    setDropTarget(null);
  }, []);

  // The tree exposes exactly one Tab stop using the roving tabindex pattern.
  // If the user has explicitly focused a row, that's the tab stop; otherwise
  // fall back to the first visible row so Tab into the tree always lands
  // somewhere.
  const tabbablePath = (() => {
    const flat = flattenVisible(orderedTree, expanded);
    if (focusedPath && flat.some((e) => e.path === focusedPath)) return focusedPath;
    return flat[0]?.path ?? null;
  })();

  const onRowKeyDown = useCallback(
    (e: React.KeyboardEvent, entry: FileEntry) => {
      const flat = flattenVisible(orderedTree, expanded);
      const idx = flat.findIndex((x) => x.path === entry.path);
      if (idx < 0) return;

      const moveFocus = (path: string) => {
        setFocusedPath(path);
        setAutoFocusPath(path);
      };

      switch (e.key) {
        case 'ArrowDown': {
          e.preventDefault();
          const next = flat[idx + 1];
          if (next) moveFocus(next.path);
          break;
        }
        case 'ArrowUp': {
          e.preventDefault();
          const prev = flat[idx - 1];
          if (prev) moveFocus(prev.path);
          break;
        }
        case 'ArrowRight': {
          e.preventDefault();
          if (entry.is_dir) {
            if (!expanded.has(entry.path)) {
              setExpanded((s) => new Set(s).add(entry.path));
            } else {
              const child = entry.children?.[0];
              if (child) moveFocus(child.path);
            }
          }
          break;
        }
        case 'ArrowLeft': {
          e.preventDefault();
          if (entry.is_dir && expanded.has(entry.path)) {
            setExpanded((s) => {
              const n = new Set(s);
              n.delete(entry.path);
              return n;
            });
          } else {
            const parent = parentOf(entry.path);
            if (parent) moveFocus(parent);
          }
          break;
        }
        case 'Enter': {
          e.preventDefault();
          if (entry.is_dir) {
            if (entry.is_kb_dir) {
              void useVaultStore.getState().openNote(`${entry.path}/index.md`, {
                preview: true,
              });
              setExpanded((s) => new Set(s).add(entry.path));
            } else {
              setExpanded((s) => {
                const n = new Set(s);
                if (n.has(entry.path)) n.delete(entry.path);
                else n.add(entry.path);
                return n;
              });
            }
          } else if (isAttachmentPath(entry.path)) {
            void useVaultStore.getState().openImageTab(entry.path, { preview: true });
          } else {
            void useVaultStore.getState().openNote(entry.path, { preview: true });
          }
          break;
        }
        case ' ': {
          // Don't hijack space on locked roots (KB/quick) since they can't be
          // renamed anyway.
          if (entry.is_knowledge_base || entry.is_quick_notes) return;
          e.preventDefault();
          setRenameRequest(entry.path);
          break;
        }
      }
    },
    [orderedTree, expanded],
  );

  const openKbMenu = useCallback((x: number, y: number, entry: FileEntry) => {
    setKbMenu({ x, y, entry });
  }, []);

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
    // Cursor is over the empty list area, not any row → destination is the
    // vault root, so clear the per-row target.
    setDropTarget(null);
  }, []);

  const handleRootDrop = useCallback(
    (e: ReactDragEvent) => {
      e.preventDefault();
      const src =
        e.dataTransfer.getData(DRAG_MIME) || e.dataTransfer.getData('text/plain');
      setDraggingPath(null);
      if (!src) return;
      if (parentOf(src) === '') return; // already at vault root
      const name = src.split('/').pop()!;
      renameNote(src, name);
      useCustomOrder.getState().renamePath(src, name);
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
        className="flex-1 overflow-y-auto py-1"
        onDragOver={handleRootDragOver}
        onDrop={handleRootDrop}
        onDragEnd={handleDragEndCapture}
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
        {orderedTree.map((entry) => (
          <FileTreeNode
            key={entry.path}
            entry={entry}
            siblings={orderedTree}
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
            openKbMenu={openKbMenu}
            focusedPath={focusedPath}
            tabbablePath={tabbablePath}
            autoFocusPath={autoFocusPath}
            setFocusedPath={setFocusedPath}
            setAutoFocusPath={setAutoFocusPath}
            draggingPath={draggingPath}
            setDraggingPath={setDraggingPath}
            dropTarget={dropTarget}
            setDropTarget={setDropTarget}
            renameRequest={renameRequest}
            clearRenameRequest={clearRenameRequest}
            onRowKeyDown={onRowKeyDown}
          />
        ))}
        {orderedTree.length === 0 && !creating && (
          <p className="text-text-muted text-xs px-3 py-4">No notes yet. Click + to create one.</p>
        )}
      </div>

      {kbMenu && (
        <KbContextMenu
          x={kbMenu.x}
          y={kbMenu.y}
          entry={kbMenu.entry}
          onClose={() => setKbMenu(null)}
        />
      )}
    </div>
  );
}
