import { useEffect, useCallback, useRef } from 'react';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { useTheme } from '@/hooks/useTheme';
import { useQuickNote } from '@/hooks/useQuickNote';
import { useAutoLock } from '@/hooks/useAutoLock';
import { useSporeMotionRootClass } from '@/hooks/useSporeMotion';
import { awaken } from '@/lib/spore-fx';
import { useVaultStore } from '@/stores/vault';
import { useUIStore } from '@/stores/ui';
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
import { isInsightsTabPath } from '@/lib/insights-tab';
import { InsightsView } from '@/components/insights/InsightsView';
import { isAttachmentPath } from '@/lib/note-name';
import { CommandPalette } from '@/components/search/CommandPalette';
import { getAppCommands, QUICK_NOTE_GLOBAL_SHORTCUT } from '@/lib/app-commands';
import { commandForHotkey, eventToHotkey, formatHotkey } from '@/lib/commands';
import { isMac } from '@/lib/platform';
import { useHotkeyBindings } from '@/hooks/useHotkeyBindings';
import { PresentationOverlay } from '@/components/presentation/PresentationOverlay';
import { Logo } from '@/components/brand/Logo';
import { Toasts } from '@/components/ui/Toasts';
import { flushAllAutosaves } from '@/lib/autosave';
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

const QUICK_NOTE_SHORTCUT = QUICK_NOTE_GLOBAL_SHORTCUT;

export default function App() {
  useTheme();
  useAutoLock();
  useSporeMotionRootClass();

  const { vaultRoot, activeTabPath, openVault, closeVault } = useVaultStore();
  const { sidebarCollapsed, rightPanelCollapsed, toggleSidebar, toggleRightPanel } = useUIStore();
  const gardenEnabled = useUIStore((s) => s.features.garden);
  const openSettings = useUIStore((s) => s.openSettings);
  const paletteOpen = useUIStore((s) => s.paletteOpen);
  const quickSwitcherOpen = useUIStore((s) => s.quickSwitcherOpen);
  const setQuickSwitcherOpen = useUIStore((s) => s.setQuickSwitcherOpen);
  const graphOpen = useUIStore((s) => s.graphOpen);
  const setGraphOpen = useUIStore((s) => s.setGraphOpen);

  // Determine which view to render in the main area: a Garden tab, a note,
  // or the empty state.
  const activeGardenView = gardenEnabled ? parseGardenTabPath(activeTabPath ?? '') : null;
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

  // In-window hotkeys. Every binding comes from the command registry
  // (`lib/app-commands.ts`), so this handler, the palette and the settings
  // screen can never disagree about what a key does.
  const bindings = useHotkeyBindings();
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const hotkey = eventToHotkey(e, isMac);
      if (!hotkey) return;
      const cmd = commandForHotkey(getAppCommands(), bindings, hotkey);
      if (!cmd) return;
      e.preventDefault();
      cmd.run();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [bindings]);

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

  // Last line of defence for unsaved work: write everything outstanding
  // before the window goes. Autosave normally gets there first — this catches
  // a quit inside the debounce window, which is exactly when the user has just
  // typed something and is most likely to mind losing it.
  //
  // `onCloseRequested` lets us finish the writes before the window closes;
  // `beforeunload` covers a reload or a webview teardown that does not route
  // through Tauri.
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    void getCurrentWindow()
      .onCloseRequested(async (event) => {
        event.preventDefault();
        try {
          await flushAllAutosaves();
        } catch (e) {
          console.warn('Flush on close failed:', e);
        }
        await getCurrentWindow().destroy();
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch((e) => console.warn('Close handler registration failed:', e));

    const onBeforeUnload = () => {
      void flushAllAutosaves();
    };
    window.addEventListener('beforeunload', onBeforeUnload);

    return () => {
      unlisten?.();
      window.removeEventListener('beforeunload', onBeforeUnload);
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

  // Each time a vault opens, a spore germinates and the workspace grows in.
  useEffect(() => {
    if (vaultRoot) awaken();
  }, [vaultRoot]);

  /** Tooltip / badge text for a command's current hotkey ('' when unbound). */
  const hotkeyLabel = (id: string) => {
    const hk = bindings[id];
    return hk ? formatHotkey(hk, isMac) : '';
  };

  const closeQuickSwitcher = useCallback(() => setQuickSwitcherOpen(false), [setQuickSwitcherOpen]);

  if (!vaultRoot) {
    return (
      <div className="h-screen bg-surface-1">
        <VaultPicker />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-surface-1 text-text-primary">
      <div className="flex flex-col flex-1 min-h-0 myc-awaken">
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
          {hotkeyLabel('switcher.open') && (
            <kbd className="text-[10px] bg-surface-2 px-1 rounded">{hotkeyLabel('switcher.open')}</kbd>
          )}
          </button>

          <div className="flex items-center gap-1">
            <LockBadge />

            <button
              onClick={() => createQuickNote()}
              className="p-1.5 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
            title={`Quick note (${hotkeyLabel('note.quick')} — works globally)`}
            >
              <Zap size={16} />
            </button>

            <button
              onClick={() => setGraphOpen(true)}
              className="p-1.5 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
            title={hotkeyLabel('graph.toggle') ? `Graph view (${hotkeyLabel('graph.toggle')})` : 'Graph view'}
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
          <main data-spore-target className="flex flex-col flex-1 min-w-0">
            <EditorTabs />
            {activeGardenView ? (
              <GardenView view={activeGardenView} />
            ) : isInsightsTabPath(activeTabPath) ? (
              <InsightsView />
            ) : activeTabPath && isAttachmentPath(activeTabPath) ? (
              <ImageViewer key={activeTabPath} path={activeTabPath} />
            ) : activeTabPath &&
              !isGardenTabPath(activeTabPath) &&
              !isInsightsTabPath(activeTabPath) ? (
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
      </div>

      {/* Quick Switcher overlay */}
      {quickSwitcherOpen && <QuickSwitcher onClose={closeQuickSwitcher} />}

      {/* Command palette (⌘P) */}
      {paletteOpen && <CommandPalette />}

      {/* Graph view overlay */}
      {graphOpen && <GraphView onClose={() => setGraphOpen(false)} />}

      {/* Save-conflict resolution. The store decides whether to render. */}
      <ConflictDialog />

      {/* Garden quick-capture (⌘I). Self-renders when open. */}
      {gardenEnabled && <QuickCapture />}

      {/* Settings dialog. Self-renders when open. */}
      <SettingsDialog />

      {/* Presentation overlay. Self-renders (via portal) only when open. */}
      <PresentationOverlay />

      {/* Transient errors and confirmations. Self-renders from the store. */}
      <Toasts />
    </div>
  );
}
