import { useCallback } from 'react';
import { useVaultStore } from '@/stores/vault';

function todayPath(): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `daily/${yyyy}-${mm}-${dd}.md`;
}

export function useDailyNote() {
  const { openNote, createNote, noteCache, vaultRoot } = useVaultStore();

  return useCallback(async () => {
    if (!vaultRoot) return;
    const path = todayPath();
    try {
      await openNote(path);
    } catch {
      // Note doesn't exist yet — create it
      try {
        await createNote(path);
      } catch (e) {
        console.error('Failed to create daily note:', e);
      }
    }
  }, [vaultRoot, openNote, createNote, noteCache]);
}
