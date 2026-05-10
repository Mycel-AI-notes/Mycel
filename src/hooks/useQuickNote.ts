import { useCallback } from 'react';
import { useVaultStore } from '@/stores/vault';

export const QUICK_NOTES_DIR = 'quick';

function quickNotePath(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  const ss = String(d.getSeconds()).padStart(2, '0');
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${QUICK_NOTES_DIR}/${yyyy}-${mm}-${dd}_${hh}-${mi}-${ss}-${ms}.md`;
}

export function useQuickNote() {
  const { vaultRoot, openNote, createNote } = useVaultStore();

  return useCallback(async () => {
    if (!vaultRoot) return;
    const path = quickNotePath();
    try {
      await createNote(path);
    } catch {
      // Extremely unlikely (same-ms collision) — fall through to open if it exists.
      try {
        await openNote(path);
      } catch (e) {
        console.error('Failed to create quick note:', e);
      }
    }
  }, [vaultRoot, openNote, createNote]);
}
