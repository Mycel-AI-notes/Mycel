import { useEffect, useState, useCallback, useRef } from 'react';
import { useTheme } from '@/hooks/useTheme';
import { useDailyNote } from '@/hooks/useDailyNote';
import { useVaultStore } from '@/stores/vault';
import { useUIStore } from '@/stores/ui';
import { useRecentVaults } from '@/stores/recentVaults';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { EditorTabs } from '@/components/editor/EditorTabs';
import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import { EmptyEditor } from '@/components/editor/EmptyEditor';
import { RightPanel } from '@/components/ui/RightPanel';
import { VaultPicker } from '@/components/onboarding/VaultPicker';
import { QuickSwitcher } from '@/components/search/QuickSwitcher';
import { Logo } from '@/components/brand/Logo';
import {
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  CalendarDays,
  FolderSearch,
} from 'lucide-react';

export default function App() {
  useTheme();

  const { vaultRoot, activeTabPath, openVault, closeVault } = useVaultStore();
  const { sidebarCollapsed, rightPanelCollapsed, toggleSidebar, toggleRightPanel } = useUIStore();
  const [quickSwitcherOpen, setQuickSwitcherOpen] = useState(false);
  const openDailyNote = useDailyNote();
  const autoOpenAttempted = useRef(false);

  // Auto-open the last vault on startup. If it fails (folder moved/deleted),
  // forget it so we don't loop the user into the same broken vault.
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

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod) return;

      if (e.key === 'o' || e.key === 'O') {
        e.preventDefault();
        if (vaultRoot) setQuickSwitcherOpen(true);
      }
      if (e.key === 'd' || e.key === 'D') {
        e.preventDefault();
        openDailyNote();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [vaultRoot, openDailyNote]);

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
      {/* Toolbar */}
      <header className="flex items-center px-3 py-1.5 border-b border-border bg-surface-0 shrink-0 gap-2">
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
          <button
            onClick={closeVault}
            className="p-1.5 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
            title="Manage vaults — back to vault picker"
          >
            <FolderSearch size={16} />
          </button>

          <button
            onClick={openDailyNote}
            className="p-1.5 rounded hover:bg-surface-hover text-text-muted hover:text-text-primary transition-colors"
            title="Daily note (Cmd+D)"
          >
            <CalendarDays size={16} />
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

        {/* Editor area */}
        <main className="flex flex-col flex-1 min-w-0">
          <EditorTabs />
          {activeTabPath ? (
            <MarkdownEditor key={activeTabPath} path={activeTabPath} />
          ) : (
            <EmptyEditor />
          )}
        </main>

        {!rightPanelCollapsed && <RightPanel />}
      </div>

      {/* Quick Switcher overlay */}
      {quickSwitcherOpen && <QuickSwitcher onClose={closeQuickSwitcher} />}
    </div>
  );
}
