import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { FileEntry } from '@/types';

interface CustomOrderState {
  // Maps a parent folder path ('' = vault root) to an ordered list of child
  // names. Entries not present in the list fall back to the backend's
  // folders-first/alphabetical order after the listed ones.
  orderMap: Record<string, string[]>;
  setOrder: (parentPath: string, order: string[]) => void;
  renamePath: (oldPath: string, newPath: string) => void;
}

export const useCustomOrder = create<CustomOrderState>()(
  persist(
    (set) => ({
      orderMap: {},
      setOrder: (parentPath, order) =>
        set((s) => ({ orderMap: { ...s.orderMap, [parentPath]: order } })),
      renamePath: (oldPath, newPath) =>
        set((s) => {
          const oldParent = parentOf(oldPath);
          const newParent = parentOf(newPath);
          const oldName = baseName(oldPath);
          const newName = baseName(newPath);
          const next = { ...s.orderMap };
          // Drop the old name from its previous parent's order.
          const fromList = next[oldParent];
          if (fromList) {
            const filtered = fromList.filter((n) => n !== oldName);
            if (filtered.length !== fromList.length) next[oldParent] = filtered;
          }
          // If the target parent has no explicit order yet, leave it alone —
          // the new entry will fall through to the natural sort.
          const toList = next[newParent];
          if (toList && !toList.includes(newName)) {
            next[newParent] = [...toList, newName];
          }
          return { orderMap: next };
        }),
    }),
    { name: 'mycel-custom-order' },
  ),
);

function parentOf(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? '' : path.slice(0, i);
}

function baseName(path: string): string {
  const i = path.lastIndexOf('/');
  return i === -1 ? path : path.slice(i + 1);
}

export function applyChildOrder(
  parentPath: string,
  entries: FileEntry[],
  orderMap: Record<string, string[]>,
): FileEntry[] {
  const order = orderMap[parentPath];
  if (!order || order.length === 0) return entries;
  const byName = new Map(entries.map((e) => [e.name, e]));
  const placed = new Set<string>();
  const out: FileEntry[] = [];
  for (const name of order) {
    const e = byName.get(name);
    if (e) {
      out.push(e);
      placed.add(name);
    }
  }
  for (const e of entries) {
    if (!placed.has(e.name)) out.push(e);
  }
  return out;
}

export function orderTree(
  entries: FileEntry[],
  parentPath: string,
  orderMap: Record<string, string[]>,
): FileEntry[] {
  const ordered = applyChildOrder(parentPath, entries, orderMap);
  return ordered.map((e) =>
    e.is_dir && e.children
      ? { ...e, children: orderTree(e.children, e.path, orderMap) }
      : e,
  );
}
