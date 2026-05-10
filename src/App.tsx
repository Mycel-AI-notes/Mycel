import { useTheme } from '@/hooks/useTheme';
import { useVaultStore } from '@/stores/vault';
import { useUIStore } from '@/stores/ui';
import { Sidebar } from '@/components/sidebar/Sidebar';
import { EditorTabs } from '@/components/editor/EditorTabs';
import { MarkdownEditor } from '@/components/editor/MarkdownEditor';
import { EmptyEditor } from '@/components/editor/EmptyEditor';
import { RightPanel } from '@/components/ui/RightPanel';
import { VaultPicker } from '@/components/onboarding/VaultPicker';
import { PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen } from 'lucide-react';

export default function App() {
  useTheme();

  const { vaultRoot, activeTabPath } = useVaultStore();
  const { sidebarCollapsed, rightPanelCollapsed, toggleSidebar, toggleRightPanel } = useUIStore();

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
        <button
          onClick={toggleSidebar}
          className="p-1.5 rounded hover:bg-white/10 text-text-muted hover:text-text-primary"
          title="Toggle sidebar"
        >
          {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
        </button>

        <span className="flex-1 text-center text-xs text-text-muted truncate font-mono">
          {vaultRoot.split('/').pop() ?? vaultRoot}
        </span>

        <button
          onClick={toggleRightPanel}
          className="p-1.5 rounded hover:bg-white/10 text-text-muted hover:text-text-primary"
          title="Toggle right panel"
        >
          {rightPanelCollapsed ? <PanelRightOpen size={16} /> : <PanelRightClose size={16} />}
        </button>
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
    </div>
  );
}
