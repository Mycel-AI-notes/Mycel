/**
 * Every command the app offers, in one list.
 *
 * The palette (`⌘/Ctrl+P`), the in-window key handler in `App.tsx` and the
 * hotkey settings all read `getAppCommands()`; adding a command here is the
 * whole job of making it reachable. Commands act through the stores'
 * `getState()` rather than React state so they can run from anywhere — a key
 * press, a palette row, a slash-menu entry.
 *
 * Pure hotkey parsing and conflict rules live in `commands.ts`.
 */
import type { Command } from './commands';
import { useVaultStore } from '@/stores/vault';
import { useUIStore, READABLE_WIDTH_STEP } from '@/stores/ui';
import { useGardenStore } from '@/stores/garden';
import { useSyncStore } from '@/stores/sync';
import { usePresentationStore } from '@/stores/presentation';
import { isGardenTabPath } from './garden-tab';
import { isInsightsTabPath } from './insights-tab';
import { isAttachmentPath } from './note-name';
import { getEditorView } from './editor-registry';
import { createQuickNote } from '@/hooks/useQuickNote';
import { openAdjacentDailyNote, openDailyNote } from './daily-actions';
import type { GardenView } from '@/types/garden';

/** The OS-wide quick-note shortcut, in the global-shortcut plugin's spelling. */
export const QUICK_NOTE_GLOBAL_SHORTCUT = 'CommandOrControl+Shift+N';

/** Event a note editor listens for to save itself. Saving goes through the
 *  editor rather than straight to the store so it picks up the editor's own
 *  side effects (the quick-filing bar refreshes after a quick note saves). */
export const SAVE_EVENT = 'mycel:save';

const vaultOpen = () => !!useVaultStore.getState().vaultRoot;
const gardenOn = () => vaultOpen() && useUIStore.getState().features.garden;

/** A note tab that has a document behind it (not Garden, Insights or an image). */
function activeNotePath(): string | null {
  const path = useVaultStore.getState().activeTabPath;
  if (!path || isGardenTabPath(path) || isInsightsTabPath(path) || isAttachmentPath(path)) {
    return null;
  }
  return path;
}

function presentActiveNote() {
  const path = activeNotePath();
  if (path) {
    const content =
      getEditorView(path)?.state.doc.toString() ??
      useVaultStore.getState().noteCache.get(path)?.content ??
      '';
    usePresentationStore.getState().start(content, path);
    return;
  }
  // ⌘⇧P historically opened Garden Projects; keep that as the fallback
  // when there is nothing to present, so the old muscle memory still works.
  if (gardenOn()) {
    useVaultStore.getState().openGardenTab({ kind: 'projects' }, { preview: true });
  }
}

function saveActive() {
  const { activeTabPath, pinTab } = useVaultStore.getState();
  if (!activeTabPath) return;
  if (isGardenTabPath(activeTabPath)) {
    // No document to save on a Garden tab, but the user expects the same
    // "promote preview to pinned" gesture.
    pinTab(activeTabPath);
    return;
  }
  getEditorView(activeTabPath)?.dom.dispatchEvent(new CustomEvent(SAVE_EVENT));
}

/** Resize the note column, switching readable width on if it was off. */
function nudgeReadableWidth(delta: number) {
  const ui = useUIStore.getState();
  if (!ui.features.readableWidth) ui.setFeature('readableWidth', true);
  ui.setReadableWidth(ui.readableWidth + delta);
}

/** Put keyboard focus on the file tree — on the open note's row when it is
 *  visible, else the first row — so ↑/↓ walk the files. */
function focusFileTree() {
  const ui = useUIStore.getState();
  if (ui.sidebarCollapsed) ui.toggleSidebar();
  requestAnimationFrame(() => {
    const active = useVaultStore.getState().activeTabPath;
    const rows = document.querySelectorAll<HTMLElement>('[data-tree-path]');
    const row =
      Array.from(rows).find((r) => r.dataset.treePath === active) ?? rows[0];
    row?.focus();
  });
}

function toggleTheme() {
  const ui = useUIStore.getState();
  const dark = document.documentElement.classList.contains('dark');
  ui.setTheme(dark ? 'light' : 'dark');
}

function gardenView(id: string, title: string, view: GardenView, hotkey?: string): Command {
  return {
    id,
    title,
    section: 'Garden',
    defaultHotkey: hotkey,
    enabled: gardenOn,
    run: () => useVaultStore.getState().openGardenTab(view, { preview: true }),
  };
}

let cached: Command[] | null = null;

/** The full command list. Built once — commands read state when they run,
 *  not when they are declared. */
export function getAppCommands(): Command[] {
  if (cached) return cached;
  cached = [
    {
      id: 'palette.open',
      title: 'Open command palette',
      section: 'App',
      defaultHotkey: 'Mod+P',
      enabled: vaultOpen,
      run: () => useUIStore.getState().setPaletteOpen(true),
    },
    {
      id: 'omnibar.open',
      title: 'Search notes and commands',
      section: 'Navigation',
      defaultHotkey: 'Mod+K',
      enabled: vaultOpen,
      run: () => useUIStore.getState().setQuickSwitcherOpen(true),
    },
    {
      id: 'switcher.open',
      title: 'Quick switcher: open note',
      section: 'Navigation',
      defaultHotkey: 'Mod+O',
      enabled: vaultOpen,
      run: () => useUIStore.getState().setQuickSwitcherOpen(true),
    },
    {
      id: 'search.fulltext',
      title: 'Search in notes (full text)',
      section: 'Navigation',
      // Plain Mod+F stays with the editor's in-note find panel.
      defaultHotkey: 'Mod+Shift+F',
      enabled: vaultOpen,
      // Same box as ⌘K — it searches inside notes too.
      run: () => useUIStore.getState().setQuickSwitcherOpen(true),
    },
    {
      id: 'note.quick',
      title: 'New quick note',
      section: 'Notes',
      defaultHotkey: 'Mod+Shift+N',
      global: true,
      enabled: vaultOpen,
      run: () => void createQuickNote(),
    },
    {
      id: 'note.save',
      title: 'Save current note',
      section: 'Notes',
      defaultHotkey: 'Mod+S',
      enabled: () => !!useVaultStore.getState().activeTabPath,
      run: saveActive,
    },
    {
      id: 'note.present',
      title: 'Present current note',
      section: 'Notes',
      defaultHotkey: 'Mod+Shift+P',
      enabled: () => !!activeNotePath() || gardenOn(),
      run: presentActiveNote,
    },
    {
      id: 'daily.today',
      title: "Open today's daily note",
      section: 'Daily notes',
      defaultHotkey: 'Mod+Shift+D',
      enabled: vaultOpen,
      run: () => void openDailyNote(),
    },
    {
      id: 'daily.previous',
      title: 'Previous daily note',
      section: 'Daily notes',
      enabled: vaultOpen,
      run: () => void openAdjacentDailyNote(-1),
    },
    {
      id: 'daily.next',
      title: 'Next daily note',
      section: 'Daily notes',
      enabled: vaultOpen,
      run: () => void openAdjacentDailyNote(1),
    },
    {
      id: 'template.insert',
      title: 'Insert template…',
      section: 'Notes',
      enabled: () => !!activeNotePath(),
      run: () => useUIStore.getState().setTemplatePickerOpen(true),
    },
    {
      id: 'graph.toggle',
      title: 'Toggle graph view',
      section: 'Navigation',
      defaultHotkey: 'Mod+G',
      enabled: vaultOpen,
      run: () => {
        const ui = useUIStore.getState();
        ui.setGraphOpen(!ui.graphOpen);
      },
    },
    {
      id: 'insights.open',
      title: 'Open Insights',
      section: 'Navigation',
      enabled: vaultOpen,
      run: () => useVaultStore.getState().openInsightsTab({ preview: true }),
    },
    {
      id: 'garden.capture',
      title: 'Garden: quick capture',
      section: 'Garden',
      defaultHotkey: 'Mod+I',
      enabled: gardenOn,
      run: () => useGardenStore.getState().openCapture(),
    },
    gardenView('garden.inbox', 'Garden: open Inbox', { kind: 'inbox' }),
    gardenView('garden.actions', 'Garden: open Next Actions', { kind: 'actions' }, 'Mod+Shift+A'),
    gardenView('garden.projects', 'Garden: open Projects', { kind: 'projects' }),
    gardenView('garden.waiting', 'Garden: open Waiting For', { kind: 'waiting' }),
    gardenView('garden.someday', 'Garden: open Someday', { kind: 'someday' }),
    gardenView('garden.review', 'Garden: weekly review', { kind: 'review' }),
    {
      id: 'garden.toggleSection',
      title: 'Garden: toggle sidebar section',
      section: 'Garden',
      defaultHotkey: 'Mod+`',
      enabled: gardenOn,
      run: () => useGardenStore.getState().toggleSection(),
    },
    {
      id: 'sync.now',
      title: 'Sync now',
      section: 'App',
      enabled: () => {
        const status = useSyncStore.getState().status;
        return vaultOpen() && !!status?.configured && !!status?.has_token;
      },
      run: () => void useSyncStore.getState().syncNow(),
    },
    {
      id: 'view.toggleSidebar',
      title: 'Toggle left sidebar',
      section: 'View',
      enabled: vaultOpen,
      run: () => useUIStore.getState().toggleSidebar(),
    },
    {
      id: 'view.focusFileTree',
      title: 'Focus file tree',
      section: 'View',
      defaultHotkey: 'Mod+Shift+E',
      enabled: vaultOpen,
      run: focusFileTree,
    },
    {
      id: 'view.toggleRightPanel',
      title: 'Toggle right panel',
      section: 'View',
      enabled: vaultOpen,
      run: () => useUIStore.getState().toggleRightPanel(),
    },
    {
      id: 'view.focus',
      title: 'Toggle focus mode',
      section: 'View',
      defaultHotkey: 'Mod+.',
      enabled: () => !!activeNotePath() || useUIStore.getState().focusMode,
      run: () => useUIStore.getState().toggleFocusMode(),
    },
    {
      id: 'view.readableWidth',
      title: 'Toggle readable line width',
      section: 'View',
      run: () => {
        const ui = useUIStore.getState();
        ui.setFeature('readableWidth', !ui.features.readableWidth);
      },
    },
    {
      id: 'view.widerText',
      title: 'Wider text column',
      section: 'View',
      run: () => nudgeReadableWidth(READABLE_WIDTH_STEP),
    },
    {
      id: 'view.narrowerText',
      title: 'Narrower text column',
      section: 'View',
      run: () => nudgeReadableWidth(-READABLE_WIDTH_STEP),
    },
    {
      id: 'view.toggleTheme',
      title: 'Toggle light/dark theme',
      section: 'View',
      run: toggleTheme,
    },
    {
      id: 'settings.open',
      title: 'Open settings',
      section: 'App',
      defaultHotkey: 'Mod+,',
      run: () => useUIStore.getState().openSettings(),
    },
    {
      id: 'vault.switch',
      title: 'Switch vault…',
      section: 'App',
      enabled: vaultOpen,
      run: () => useVaultStore.getState().closeVault(),
    },
  ];
  return cached;
}
