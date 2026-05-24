import {
  useState,
  useCallback,
  useRef,
  useEffect,
  useMemo,
  createContext,
  useContext,
} from 'react';
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
import { toast } from '@/stores/toast';
import { stripNoteExt, isAttachmentPath } from '@/lib/note-name';
import { KbContextMenu } from '@/components/kb/KbContextMenu';

const DRAG_MIME = 'application/x-mycel-path';
// Multiple dragged paths are packed newline-separated into the transfer.
const DRAG_SEP = '\n';
// How long a collapsed folder must be hovered mid-drag before it springs open.
const SPRING_MS = 650;
// Auto-scroll trigger band (px) and speed (px/frame) near the list edges.
const AUTOSCROLL_EDGE = 40;
const AUTOSCROLL_SPEED = 12;

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

function isProtectedPath(path: string): boolean {
  return path === KNOWLEDGE_BASE_DIR || path === QUICK_NOTES_DIR;
}

// Dropping onto a file targets its containing folder (Finder/VS Code style),
// so files are never a dead drop zone.
function targetDirOf(entry: FileEntry): string {
  return entry.is_dir ? entry.path : parentOf(entry.path);
}

// A move is only valid if it actually relocates the item somewhere new and
// doesn't fold a folder into its own subtree.
function canDrop(src: string, dstDir: string): boolean {
  if (!src) return false;
  if (src === dstDir) return false; // onto itself
  if (dstDir === src) return false;
  if (dstDir.startsWith(src + '/')) return false; // into own descendant
  if (parentOf(src) === dstDir) return false; // already there
  return true;
}

function findEntry(tree: FileEntry[], path: string): FileEntry | null {
  for (const e of tree) {
    if (e.path === path) return e;
    if (e.children) {
      const found = findEntry(e.children, path);
      if (found) return found;
    }
  }
  return null;
}

function nameExistsIn(tree: FileEntry[], dir: string, name: string): boolean {
  const list = dir === '' ? tree : findEntry(tree, dir)?.children ?? [];
  return list.some((c) => c.name === name);
}

function readTransfer(e: ReactDragEvent): string[] {
  const raw =
    e.dataTransfer.getData(DRAG_MIME) || e.dataTransfer.getData('text/plain');
  return raw ? raw.split(DRAG_SEP).filter(Boolean) : [];
}

// Build a compact drag ghost so the cursor carries a small chip instead of the
// browser's default snapshot of the full row (with its hover buttons).
function makeDragImage(srcs: string[], entry: FileEntry): HTMLElement {
  const el = document.createElement('div');
  el.textContent =
    srcs.length > 1
      ? `${srcs.length} items`
      : entry.is_dir
        ? entry.name
        : stripNoteExt(entry.name);
  el.className =
    'px-2.5 py-1 rounded-md text-xs font-medium bg-accent text-white shadow-lg';
  el.style.position = 'fixed';
  el.style.top = '-1000px';
  el.style.left = '0';
  el.style.pointerEvents = 'none';
  document.body.appendChild(el);
  return el;
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

interface TreeDndValue {
  dragSrcs: string[];
  dropTarget: string | null; // folder path being targeted; '' = root
  cutPaths: Set<string>;
  selected: Set<string>;
  beginDrag: (e: ReactDragEvent, entry: FileEntry) => void;
  overRow: (e: ReactDragEvent, entry: FileEntry) => void;
  dropRow: (e: ReactDragEvent, entry: FileEntry) => void;
  endDrag: () => void;
  selectRow: (e: React.MouseEvent, entry: FileEntry) => boolean;
}

const TreeDndContext = createContext<TreeDndValue | null>(null);

function useTreeDnd(): TreeDndValue {
  const v = useContext(TreeDndContext);
  if (!v) throw new Error('TreeDndContext missing');
  return v;
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
  openKbMenu: (x: number, y: number, entry: FileEntry) => void;
  focusedPath: string | null;
  tabbablePath: string | null;
  autoFocusPath: string | null;
  setFocusedPath: (p: string | null) => void;
  renameRequest: string | null;
  clearRenameRequest: () => void;
  onRowKeyDown: (e: React.KeyboardEvent, entry: FileEntry) => void;
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
  openKbMenu,
  focusedPath,
  tabbablePath,
  autoFocusPath,
  setFocusedPath,
  renameRequest,
  clearRenameRequest,
  onRowKeyDown,
}: NodeProps) {
  const [renaming, setRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState('');
  const dnd = useTreeDnd();
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

  const isBeingDragged = dnd.dragSrcs.includes(entry.path);
  const isCut = dnd.cutPaths.has(entry.path);
  // Single selection rides the existing active/focus styling; only show the
  // dedicated selection highlight once the user is actually multi-selecting.
  const isMultiSelected = dnd.selected.has(entry.path) && dnd.selected.size > 1;
  const isDropTarget =
    entry.is_dir && dnd.dropTarget !== null && dnd.dropTarget === entry.path;

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

  const commitRename = useCallback(async () => {
    const trimmed = renameValue.trim();
    const original = entry.is_dir ? entry.name : stripNoteExt(entry.name);
    if (trimmed && trimmed !== original) {
      const dir = parentOf(entry.path);
      const ext = entry.is_dir ? '' : isEnc ? '.md.age' : '.md';
      const base = stripNoteExt(trimmed);
      const newPath = joinPath(dir, `${base}${ext}`);
      try {
        await renameNote(entry.path, newPath);
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    }
    setRenaming(false);
  }, [renameValue, entry, renameNote, isEnc]);

  return (
    <div>
      <div
        ref={rowRef}
        draggable={!renaming && !isLocked}
        tabIndex={isTabbable ? 0 : -1}
        onDragStart={(e) => dnd.beginDrag(e, entry)}
        onDragOver={(e) => dnd.overRow(e, entry)}
        onDrop={(e) => dnd.dropRow(e, entry)}
        onDragEnd={dnd.endDrag}
        className={clsx(
          'group flex items-center gap-1 px-2 py-0.5 rounded cursor-pointer text-sm select-none transition-colors outline-none',
          'hover:bg-surface-hover focus-visible:ring-1 focus-visible:ring-accent/60',
          isActive && 'bg-accent/12 text-accent',
          !isActive && 'text-text-secondary',
          isFocused && !isActive && 'bg-surface-hover',
          isMultiSelected && 'bg-accent/15',
          isDropTarget && 'bg-accent/15 ring-1 ring-accent/40',
          isBeingDragged && 'opacity-50',
          isCut && 'opacity-60 italic',
        )}
        style={{ paddingLeft: `${depth * 12 + 8}px` }}
        onClick={(e) => {
          // Modifier-clicks manage multi-selection and must not open the note.
          if (dnd.selectRow(e, entry)) return;
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
              openKbMenu={openKbMenu}
              focusedPath={focusedPath}
              tabbablePath={tabbablePath}
              autoFocusPath={autoFocusPath}
              setFocusedPath={setFocusedPath}
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
  const [creating, setCreating] = useState<CreatingState | null>(null);
  const [newName, setNewName] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [kbMenu, setKbMenu] = useState<KbMenuState | null>(null);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);
  const [autoFocusPath, setAutoFocusPath] = useState<string | null>(null);
  const [renameRequest, setRenameRequest] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const initializedRef = useRef(false);

  // --- Drag / selection / clipboard state -------------------------------
  const [dragSrcs, setDragSrcs] = useState<string[]>([]);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [cutPaths, setCutPaths] = useState<Set<string>>(new Set());
  const [selAnchor, setSelAnchor] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const dragYRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  // Set true by a row's dragover so the container handler knows a row already
  // claimed the drop target this event (and shouldn't reset it to root).
  const claimedRef = useRef(false);
  // Spring-loaded folder: which folder is pending auto-expand and its timer.
  const springRef = useRef<{ path: string | null; timer: number | null }>({
    path: null,
    timer: null,
  });

  const clearRenameRequest = useCallback(() => setRenameRequest(null), []);

  const stopAutoScroll = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    dragYRef.current = null;
  }, []);

  const startAutoScroll = useCallback(() => {
    if (rafRef.current != null) return;
    const step = () => {
      const el = scrollRef.current;
      const y = dragYRef.current;
      if (el && y != null) {
        const r = el.getBoundingClientRect();
        if (y < r.top + AUTOSCROLL_EDGE) el.scrollTop -= AUTOSCROLL_SPEED;
        else if (y > r.bottom - AUTOSCROLL_EDGE) el.scrollTop += AUTOSCROLL_SPEED;
      }
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }, []);

  const clearSpring = useCallback(() => {
    if (springRef.current.timer != null) clearTimeout(springRef.current.timer);
    springRef.current = { path: null, timer: null };
  }, []);

  // Arm (or re-arm) the spring timer for the folder under the cursor. Hovering
  // a collapsed folder mid-drag expands it so the user can dive deeper without
  // dropping first.
  const scheduleSpring = useCallback(
    (path: string | null) => {
      if (springRef.current.path === path) return;
      if (springRef.current.timer != null) clearTimeout(springRef.current.timer);
      if (!path) {
        springRef.current = { path: null, timer: null };
        return;
      }
      const timer = window.setTimeout(() => {
        setExpanded((s) => (s.has(path) ? s : new Set(s).add(path)));
        springRef.current = { path: null, timer: null };
      }, SPRING_MS);
      springRef.current = { path, timer };
    },
    [],
  );

  // Perform the actual move(s). Filters invalid targets, refuses name
  // collisions (no silent clobber), and surfaces backend errors as toasts.
  const moveInto = useCallback(
    async (srcs: string[], dstDir: string) => {
      const candidates = srcs.filter((s) => canDrop(s, dstDir));
      if (candidates.length === 0) return;

      const collisions = candidates.filter((s) =>
        nameExistsIn(fileTree, dstDir, s.split('/').pop()!),
      );
      const proceed = candidates.filter((s) => !collisions.includes(s));
      if (collisions.length > 0) {
        const names = collisions.map((c) => c.split('/').pop()).join(', ');
        const where = dstDir === '' ? 'the vault root' : `"${dstDir.split('/').pop()}"`;
        toast.error(`Already exists in ${where}: ${names}`);
      }
      if (proceed.length === 0) return;

      try {
        for (const s of proceed) {
          const name = s.split('/').pop()!;
          await renameNote(s, joinPath(dstDir, name));
        }
        if (dstDir) setExpanded((s) => new Set(s).add(dstDir));
      } catch (err) {
        toast.error(err instanceof Error ? err.message : String(err));
      }
    },
    [fileTree, renameNote],
  );

  const endDrag = useCallback(() => {
    setDragSrcs([]);
    setDropTarget(null);
    claimedRef.current = false;
    stopAutoScroll();
    clearSpring();
  }, [stopAutoScroll, clearSpring]);

  const beginDrag = useCallback(
    (e: ReactDragEvent, entry: FileEntry) => {
      if (isProtectedPath(entry.path)) {
        e.preventDefault();
        return;
      }
      // Dragging a row that's part of a multi-selection moves the whole set;
      // dragging anything else narrows the selection to just that row.
      let srcs: string[];
      if (selected.has(entry.path) && selected.size > 1) {
        srcs = [...selected].filter((p) => !isProtectedPath(p));
      } else {
        srcs = [entry.path];
        setSelected(new Set([entry.path]));
        setSelAnchor(entry.path);
      }
      setDragSrcs(srcs);
      const packed = srcs.join(DRAG_SEP);
      e.dataTransfer.setData(DRAG_MIME, packed);
      e.dataTransfer.setData('text/plain', packed);
      e.dataTransfer.effectAllowed = 'move';
      const ghost = makeDragImage(srcs, entry);
      e.dataTransfer.setDragImage(ghost, 12, 12);
      setTimeout(() => ghost.remove(), 0);
      startAutoScroll();
    },
    [selected, startAutoScroll],
  );

  const overRow = useCallback(
    (e: ReactDragEvent, entry: FileEntry) => {
      if (dragSrcs.length === 0) return;
      e.preventDefault();
      claimedRef.current = true;
      const dir = targetDirOf(entry);
      const ok = dragSrcs.some((s) => canDrop(s, dir));
      e.dataTransfer.dropEffect = ok ? 'move' : 'none';
      setDropTarget(ok ? dir : null);
      // Spring open the collapsed folder directly under the cursor.
      scheduleSpring(entry.is_dir ? entry.path : null);
    },
    [dragSrcs, scheduleSpring],
  );

  const dropRow = useCallback(
    (e: ReactDragEvent, entry: FileEntry) => {
      e.preventDefault();
      e.stopPropagation();
      clearSpring();
      const srcs = dragSrcs.length ? dragSrcs : readTransfer(e);
      void moveInto(srcs, targetDirOf(entry));
      endDrag();
    },
    [dragSrcs, moveInto, endDrag, clearSpring],
  );

  const selectRow = useCallback(
    (e: React.MouseEvent, entry: FileEntry): boolean => {
      const meta = e.metaKey || e.ctrlKey;
      const shift = e.shiftKey;
      if (meta) {
        setSelected((prev) => {
          const n = new Set(prev);
          if (n.has(entry.path)) n.delete(entry.path);
          else n.add(entry.path);
          return n;
        });
        setSelAnchor(entry.path);
        return true;
      }
      if (shift && selAnchor) {
        const flat = flattenVisible(fileTree, expanded).map((x) => x.path);
        const a = flat.indexOf(selAnchor);
        const b = flat.indexOf(entry.path);
        if (a >= 0 && b >= 0) {
          const [lo, hi] = a < b ? [a, b] : [b, a];
          setSelected(new Set(flat.slice(lo, hi + 1)));
          return true;
        }
      }
      // Plain click collapses any multi-selection back to this single row.
      setSelected(new Set([entry.path]));
      setSelAnchor(entry.path);
      return false;
    },
    [fileTree, expanded, selAnchor],
  );

  const dnd = useMemo<TreeDndValue>(
    () => ({
      dragSrcs,
      dropTarget,
      cutPaths,
      selected,
      beginDrag,
      overRow,
      dropRow,
      endDrag,
      selectRow,
    }),
    [dragSrcs, dropTarget, cutPaths, selected, beginDrag, overRow, dropRow, endDrag, selectRow],
  );

  // The tree exposes exactly one Tab stop using the roving tabindex pattern.
  // If the user has explicitly focused a row, that's the tab stop; otherwise
  // fall back to the first visible row so Tab into the tree always lands
  // somewhere.
  const tabbablePath = (() => {
    const flat = flattenVisible(fileTree, expanded);
    if (focusedPath && flat.some((e) => e.path === focusedPath)) return focusedPath;
    return flat[0]?.path ?? null;
  })();

  const onRowKeyDown = useCallback(
    (e: React.KeyboardEvent, entry: FileEntry) => {
      const meta = e.metaKey || e.ctrlKey;

      // Clipboard-style move via keyboard, mirroring drag-and-drop.
      if (meta && (e.key === 'x' || e.key === 'X')) {
        e.preventDefault();
        const paths =
          selected.has(entry.path) && selected.size > 0 ? [...selected] : [entry.path];
        setCutPaths(new Set(paths.filter((p) => !isProtectedPath(p))));
        return;
      }
      if (meta && (e.key === 'v' || e.key === 'V')) {
        e.preventDefault();
        if (cutPaths.size > 0) {
          const srcs = [...cutPaths];
          setCutPaths(new Set());
          void moveInto(srcs, targetDirOf(entry));
        }
        return;
      }
      if (e.key === 'Escape') {
        if (cutPaths.size > 0 || selected.size > 0) {
          e.preventDefault();
          setCutPaths(new Set());
          setSelected(new Set());
        }
        return;
      }

      const flat = flattenVisible(fileTree, expanded);
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
    [fileTree, expanded, selected, cutPaths, moveInto],
  );

  const openKbMenu = useCallback((x: number, y: number, entry: FileEntry) => {
    setKbMenu({ x, y, entry });
  }, []);

  useEffect(() => {
    if (creating) inputRef.current?.focus();
  }, [creating]);

  // Stop any running auto-scroll loop if the tree unmounts mid-drag.
  useEffect(() => stopAutoScroll, [stopAutoScroll]);

  // Prune selection/clipboard entries that no longer exist after a refresh
  // (moved, deleted, or renamed) so stale highlights don't linger.
  useEffect(() => {
    const exists = (p: string) => findEntry(fileTree, p) != null;
    setSelected((prev) => {
      const next = new Set([...prev].filter(exists));
      return next.size === prev.size ? prev : next;
    });
    setCutPaths((prev) => {
      const next = new Set([...prev].filter(exists));
      return next.size === prev.size ? prev : next;
    });
  }, [fileTree]);

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

  // Container-level drag handling covers the empty space below the rows (drop
  // to vault root) and keeps the auto-scroll cursor position fresh even while
  // the pointer is over a row (rows don't stop propagation).
  const handleContainerDragOver = useCallback(
    (e: ReactDragEvent) => {
      if (dragSrcs.length === 0) return;
      e.preventDefault();
      dragYRef.current = e.clientY;
      if (claimedRef.current) {
        // A row already resolved the target for this event.
        claimedRef.current = false;
        return;
      }
      // Empty area → vault root.
      const ok = dragSrcs.some((s) => canDrop(s, ''));
      e.dataTransfer.dropEffect = ok ? 'move' : 'none';
      setDropTarget(ok ? '' : null);
      scheduleSpring(null);
    },
    [dragSrcs, scheduleSpring],
  );

  const handleContainerDragLeave = useCallback((e: ReactDragEvent) => {
    if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
    setDropTarget(null);
    claimedRef.current = false;
  }, []);

  const handleContainerDrop = useCallback(
    (e: ReactDragEvent) => {
      e.preventDefault();
      const srcs = dragSrcs.length ? dragSrcs : readTransfer(e);
      void moveInto(srcs, '');
      endDrag();
    },
    [dragSrcs, moveInto, endDrag],
  );

  if (!vaultRoot) return null;

  const rootIsTarget = dropTarget === '';

  return (
    <TreeDndContext.Provider value={dnd}>
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
          ref={scrollRef}
          className={clsx(
            'flex-1 overflow-y-auto py-1 transition-colors',
            rootIsTarget && 'bg-accent/5 ring-1 ring-inset ring-accent/30',
          )}
          onDragOver={handleContainerDragOver}
          onDragLeave={handleContainerDragLeave}
          onDrop={handleContainerDrop}
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
              openKbMenu={openKbMenu}
              focusedPath={focusedPath}
              tabbablePath={tabbablePath}
              autoFocusPath={autoFocusPath}
              setFocusedPath={setFocusedPath}
              renameRequest={renameRequest}
              clearRenameRequest={clearRenameRequest}
              onRowKeyDown={onRowKeyDown}
            />
          ))}
          {fileTree.length === 0 && !creating && (
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
    </TreeDndContext.Provider>
  );
}
