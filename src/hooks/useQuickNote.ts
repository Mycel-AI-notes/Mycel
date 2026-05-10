import { useCallback } from 'react';
import { useVaultStore } from '@/stores/vault';
import { QUICK_NOTES_DIR } from '@/types';
import type { FileEntry } from '@/types';

function pad(n: number, width = 2): string {
  return String(n).padStart(width, '0');
}

function todayFolder(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function timeStem(d: Date): string {
  return `${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}

/** Returns set of .md filenames (no extension, no path) inside quick/YYYY-MM-DD/. */
function existingStems(tree: FileEntry[], day: string): Set<string> {
  const quickRoot = tree.find((e) => e.is_dir && e.path === QUICK_NOTES_DIR);
  const dayFolder = quickRoot?.children?.find((e) => e.is_dir && e.name === day);
  const out = new Set<string>();
  for (const child of dayFolder?.children ?? []) {
    if (!child.is_dir) out.add(child.name.replace(/\.md$/, ''));
  }
  return out;
}

export function useQuickNote() {
  const { vaultRoot, createNote } = useVaultStore();

  return useCallback(async () => {
    if (!vaultRoot) return;

    const d = new Date();
    const day = todayFolder(d);
    const base = timeStem(d);
    const taken = existingStems(useVaultStore.getState().fileTree, day);

    let stem = base;
    let suffix = 1;
    while (taken.has(stem) && suffix < 1000) {
      stem = `${base}-${suffix}`;
      suffix++;
    }

    const path = `${QUICK_NOTES_DIR}/${day}/${stem}.md`;
    try {
      await createNote(path);
    } catch (e) {
      console.error('Failed to create quick note:', e);
    }
  }, [vaultRoot, createNote]);
}
