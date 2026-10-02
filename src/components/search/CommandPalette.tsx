import { useUIStore } from '@/stores/ui';
import { QuickSwitcher } from './QuickSwitcher';

/**
 * `⌘/Ctrl+P`: the same search box as `⌘K`, opened in command mode (`>`).
 * One window to learn; deleting the `>` turns it back into note search.
 */
export function CommandPalette() {
  const close = useUIStore((s) => s.setPaletteOpen);
  return <QuickSwitcher initialQuery=">" onClose={() => close(false)} />;
}
