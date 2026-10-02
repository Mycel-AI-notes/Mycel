import { useMemo } from 'react';
import { Command as CommandIcon } from 'lucide-react';
import { useUIStore } from '@/stores/ui';
import { getAppCommands } from '@/lib/app-commands';
import { formatHotkey } from '@/lib/commands';
import { useHotkeyBindings } from '@/hooks/useHotkeyBindings';
import { isMac } from '@/lib/platform';
import { PickerDialog, type PickerItem } from './PickerDialog';

/**
 * `⌘/Ctrl+P`: every enabled command, fuzzy-filtered, with its hotkey. Reads
 * the same registry as the key handler, so the hotkey shown is the one that
 * actually fires — including a user's rebinding.
 */
export function CommandPalette() {
  const close = useUIStore((s) => s.setPaletteOpen);
  const bindings = useHotkeyBindings();

  const items = useMemo(() => {
    const commands = getAppCommands();
    return commands
      .filter((c) => c.id !== 'palette.open' && (c.enabled?.() ?? true))
      .map(
        (c): PickerItem & { run: () => void } => ({
          id: c.id,
          label: c.title,
          detail: c.section,
          hint: bindings[c.id] ? formatHotkey(bindings[c.id]!, isMac) : undefined,
          run: c.run,
        }),
      );
  }, [bindings]);

  return (
    <PickerDialog
      items={items}
      placeholder="Type a command…"
      emptyText="No matching commands"
      icon={<CommandIcon size={16} className="text-text-muted shrink-0" />}
      onClose={() => close(false)}
      onPick={(item) => item.run()}
    />
  );
}
