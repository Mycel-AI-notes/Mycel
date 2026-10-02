import { useMemo } from 'react';
import { getAppCommands } from '@/lib/app-commands';
import { resolveBindings, type Bindings } from '@/lib/commands';

/** The effective hotkey for every command. */
export function useHotkeyBindings(): Bindings {
  return useMemo(() => resolveBindings(getAppCommands(), {}), []);
}
