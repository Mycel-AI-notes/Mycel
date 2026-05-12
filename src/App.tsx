import { useEffect, useState, useCallback, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { useTheme } from '@/hooks/useTheme';
import { useQuickNote } from '@/hooks/useQuickNote';
import { useAutoLock } from '@/hooks/useAutoLock';
import { useVaultStore } from '@/stores/vault';
import { useUIStore } from '@/stores/ui';
import { useGardenStore } from '@/stores/garden';
import { useRecentVaults } from '@/stores/recentVaults';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { EditorTabs } from '@/components/editor/EditorTabs';
import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import { ImageViewer } from '@/components/editor/ImageViewer';
import { EmptyEditor } from '@/components/editor/EmptyEditor';
import { RightPanel } from '@/components/ui/RightPanel';
import { PalettePicker } from '@/components/ui/PalettePicker';
import { VaultPicker } from '@/components/onboarding/VaultPicker';
import { QuickSwitcher } from '@/components/search/QuickSwitcher';
import { GraphView } from '@/components/graph/GraphView';
import { ConflictDialog } from '@/components/sync/ConflictDialog';
import { GardenView } from '@/components/garden/GardenView';
import { QuickCapture } from '@/components/garden/QuickCapture';
import { SettingsDialog } from '@/components/ui/SettingsDialog';
import { parseGardenTabPath, isGardenTabPath } from '@/lib/garden-tab';
import { isAttachmentPath } from '@/lib/note-name';
import { Logo } from '@/components/brand/Logo';
import { LockBadge } from '@/components/crypto/LockBadge';
import { getCurrentWindow } from '@tauri-apps/api/window';
import {
  register,
  unregister,
  isRegistered,
} from '@tauri-apps/plugin-global-shortcut';
import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  Zap,
  FolderSearch,
  Share2,
  Settings as SettingsIcon,
} from 'lucide-react';

const QUICK_NOTE_SHORTCUT = 'CommandOrControl+Shift+N';

const isMac =
  typeof navigator !== 'undefined' &&
  /Mac|iPhone|iPad|iPod/.test(navigator.platform);

export default function App() {
  useTheme();
  useAutoLock();

  const { vaultRoot, activeTabPath, openVault, closeVault, openGardenTab, pinTab } = useVaultStore();
  const { sidebarCollapsed, rightPanelCollapsed, toggleSidebar, toggleRightPanel } = useUIStore();
  const gardenEnabled = useUIStore((s) => s.features.garden);
  const openSettings = useUIStore((s) => s.openSettings);
  const openGardenCapture = useGardenStore((s) => s.openCapture);
  const toggleGardenSection = useGardenStore((s) => s.toggleSection);

  // Determine which view to render in the main area: a Garden tab, a note,
  // or the empty state.
  const activeGardenView = gardenEnabled ? parseGardenTabPath(activeTabPath ?? '') : null;
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);
  const [graphOpen, setGraphOpen] = useState(false);
  const createQuickNote = useQuickNote();
  const autoOpenAttempted = useRef(false);

  // Keep the latest quick-note handler in a ref so the global shortcut
  // callback always sees current state without re-registering.
  const quickNoteRef = useRef(createQuickNote);
  useEffect(() => {
    quickNoteRef.current = createQuickNote;
  }, [createQuickNote]);

  useEffect(() => {
    if (autoOpenAttempted.current) return;
    if (vaultRoot) return;
    const { lastOpened, remove } = useRecentVaults.getState();
    if (!lastOpened) return;
    autoOpenAttempted.current = true;
    openVault(lastOpened).catch((e) => {
      console.error('Auto-open of last vault failed:', e);
      remove(lastOpened);
    });
  }, [vaultRoot, openVault]);

  // In-app keyboard shortcuts (Quick Switcher, Garden navigation).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      if (e.key === 'o' || e.key === 'O') {
        e.preventDefault();
        if (vaultRoot) setQuickSwitcherOpen(true);
      } else if (e.key === 'g' || e.key === 'G') {
        // Plain Cmd+G keeps Graph; Cmd+Shift+G could be reused later.
        if (e.shiftKey) return;
        e.preventDefault();
        if (vaultRoot) setGraphOpen((g) => !g);
      } else if (gardenEnabled && (e.key === 'i' || e.key === 'I')) {
        // Cmd+I — Garden quick capture.
        e.preventDefault();
        if (vaultRoot) openGardenCapture();
      } else if (gardenEnabled && e.shiftKey && (e.key === 'A' || e.key === 'a')) {
        // Cmd+Shift+A — Open Next Actions.
        e.preventDefault();
        if (vaultRoot) openGardenTab({ kind: 'actions' }, { preview: true });
      } else if (gardenEnabled && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
        // Cmd+Shift+P — Open Projects.
        e.preventDefault();
        if (vaultRoot) openGardenTab({ kind: 'projects' }, { preview: true });
      } else if (e.key === 's' || e.key === 'S') {
        // Cmd+S on a Garden tab pins it — there's no document to save, but
        // the user expects the same "promote preview to pinned" gesture.
        // For note tabs CodeMirror's keymap handles save+pin already.
        if (activeTabPath && activeTabPath.startsWith('garden:')) {
          e.preventDefault();
          pinTab(activeTabPath);
        }
      } else if (gardenEnabled && e.key === '`') {
        // Cmd+` — toggle Garden section in sidebar (Cmd+G is taken by Graph).
        e.preventDefault();
        toggleGardenSection();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [vaultRoot, openGardenCapture, openGardenTab, toggleGardenSection, gardenEnabled, activeTabPath, pinTab]);

  // OS-wide global shortcut for Quick Note — fires even when the app
  // window isn't focused. Brings the window to front, then creates the note.
  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        if (await isRegistered(QUICK_NOTE_SHORTCUT)) {
          await unregister(QUICK_NOTE_SHORTCUT);
        }
        if (cancelled) return;
        await register(QUICK_NOTE_SHORTCUT, async (event) => {
          // Tauri 2 fires both "Pressed" and "Released" — handle one.
          if (event.state !== 'Pressed') return;
          try {
            const win = getCurrentWindow();
            await win.unminimize();
            await win.show();
            await win.setFocus();
          } catch (e) {
            console.warn('Window focus failed:', e);
          }
          quickNoteRef.current?.();
        });
      } catch (e) {
        console.warn('Global shortcut registration failed:', e);
      }
    })();

    return () => {
      cancelled = true;
      unregister(QUICK_NOTE_SHORTCUT).catch(() => undefined);
    };
  }, []);

  // Backend file-watcher fires `kb:dir-changed` whenever something moves
  // inside a registered KB folder. Coalesce bursts per-KB and call
  // `kb_refresh` once it settles — that command rewrites the .db.json,
  // which in turn triggers DatabaseView's own `vault:file-changed`
  // listener to reload.
  useEffect(() => {
    if (!vaultRoot) return;
    let unlisten: UnlistenFn | undefined;
    const timers = new Map<string, ReturnType<typeof setTimeout>>();
    // 600 ms = perceived latency floor for auto-refresh. Drop to ~250
    // ms if a single-file change ever feels too slow; raise if bulk
    // operations still trigger multiple refreshes. Pairs with the
    // 750 ms per-KB throttle in core/watcher.rs.
    const SETTLE_MS = 600;

    void listen<{ path: string }>('kb:dir-changed', (e) => {
      const kbPath = e.payload?.path;
      if (!kbPath) return;
      const existing = timers.get(kbPath);
      if (existing) clearTimeout(existing);
      const t = setTimeout(() => {
        timers.delete(kbPath);
        invoke('kb_refresh', { dirPath: kbPath }).catch((err) => {
          console.warn('kb_refresh failed for', kbPath, err);
        });
      }, SETTLE_MS);
      timers.set(kbPath, t);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, [vaultRoot]);

  const closeQuickSwitcher = useCallback(() => setQuickSwitcherOpen(false), []);

  if (!vaultRoot) {
    return (
      <div className="h-screen bg-surface-1">
        <VaultPicker />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-surface-1 text-text-primary">
      {/* Top toolbar */}
      <header
        data-tauri-drag-region
        className={`flex items-center pr-3 py-1.5 border-b border-border bg-surface-0 shrink-0 gap-2 ${
          isMac ? 'pl-[78px]' : 'pl-3'
        }`}
      >
        <span
          className="flex items-center text-accent pl-0.5 pr-1"
          title="Mycel"
        >
          <Logo size={20} />
        </span>

        <button
          onClick={toggleSidebar}
          className="p-1.5 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
          title="Toggle sidebar"
        >
          {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>

        {/* Quick Switcher trigger */}
        <button
          onClick={() => setQuickSwitcherOpen(true)}
          className="flex items-center gap-2 flex-1 max-w-sm mx-auto px-3 py-1 rounded-md border border-border bg-surface-1 hover:bg-surface-2 text-text-muted text-xs"
        >
          <span className="flex-1 text-left">
            {vaultRoot.split('/').pop() ?? vaultRoot}
          </span>
          <kbd className="text-[10px] bg-surface-2 px-1 rounded">⌘O</kbd>
        </button>

        <div className="flex items-center gap-1">
          <LockBadge />

          <button
            onClick={() => createQuickNote()}
            className="p-1.5 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
            title="Quick note (⌘⇧N — works globally)"
          >
            <Zap size={16} />
          </button>

          <button
            onClick={() => setGraphOpen(true)}
            className="p-1.5 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
            title="Graph view (⌘G)"
          >
            <Share2 size={16} />
          </button>

          <button
            onClick={toggleRightPanel}
            className="p-1.5 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
            title="Toggle right panel"
          >
            {rightPanelCollapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
          </button>
        </div>
      </header>

      {/* Main layout */}
      <div className="flex flex-1 min-h-0">
        {!sidebarCollapsed && <Sidebar />}

        {/* Editor area — Garden tabs and notes share the same tab strip. */}
        <main className="flex flex-col flex-1 min-w-0">
          <EditorTabs />
          {activeGardenView ? (
            <GardenView view={activeGardenView} />
          ) : activeTabPath && isAttachmentPath(activeTabPath) ? (
            <ImageViewer key={activeTabPath} path={activeTabPath} />
          ) : activeTabPath && !isGardenTabPath(activeTabPath) ? (
            <MarkdownEditor key={activeTabPath} path={activeTabPath} />
          ) : (
            <EmptyEditor />
          )}
        </main>

        {!rightPanelCollapsed && <RightPanel />}
      </div>

      {/* Bottom status bar — vault + theme + settings */}
      <footer className="flex items-center justify-end gap-1 px-2 py-1 border-t border-border bg-surface-0 text-text-muted text-[11px] shrink-0">
        <button
          onClick={closeVault}
          className="p-1 rounded hover:bg-surface-hover hover:text-text-primary transition-colors"
          title="Manage vaults — back to vault picker"
        >
          <FolderSearch size={14} />
        </button>
        <button
          onClick={openSettings}
          className="p-1 rounded hover:bg-surface-hover hover:text-text-primary transition-colors"
          title="Settings"
        >
          <SettingsIcon size={14} />
        </button>
        <PalettePicker />
      </footer>

      {/* Quick Switcher overlay */}
      {quickSwitcherOpen && <QuickSwitcher onClose={closeQuickSwitcher} />}

      {/* Graph view overlay */}
      {graphOpen && <GraphView onClose={() => setGraphOpen(false)} />}

      {/* Save-conflict resolution. The store decides whether to render. */}
      <ConflictDialog />

      {/* Garden quick-capture (⌘I). Self-renders when open. */}
      {gardenEnabled && <QuickCapture />}

      {/* Settings dialog. Self-renders when open. */}
      <SettingsDialog />
    </div>
  );
}
