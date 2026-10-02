import { useMemo } from 'react';
import { useUIStore } from '@/stores/ui';
import { getAppCommands } from '@/lib/app-commands';
import { resolveBindings, type Bindings } from '@/lib/commands';

/** The effective hotkey for every command: defaults with the user's
 *  overrides from Settings → Hotkeys applied. */
export function useHotkeyBindings(): Bindings {
  const overrides = useUIStore((s) => s.hotkeyOverrides);
  return useMemo(() => resolveBindings(getAppCommands(), overrides ?? {}), [overrides]);
}
