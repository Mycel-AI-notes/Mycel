import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Note } from '@/types';

// The store talks to the backend only through `invoke`; stand in for the
// one command these tests reach.
const disk = new Map<string, string>();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(async (cmd: string, args: { path: string }) => {
    if (cmd !== 'note_read') throw new Error(`unexpected command ${cmd}`);
    const content = disk.get(args.path);
    if (content === undefined) throw new Error('not found');
    return {
      path: args.path,
      content,
      parsed: { meta: { tags: [] } },
      disk_hash: `hash:${content}`,
    };
  }),
}));

const { useVaultStore } = await import('./vault');
const { hasPendingAutosave, scheduleAutosave } = await import('@/lib/autosave');

function cached(path: string, content: string): Note {
  return {
    path,
    content,
    parsed: { meta: { tags: [] } },
    disk_hash: `hash:${content}`,
  } as unknown as Note;
}

describe('reloadNote / forgetNote (quick-note merge aftermath)', () => {
  beforeEach(() => {
    disk.clear();
    useVaultStore.setState({
      noteCache: new Map(),
      openTabs: [],
      activeTabPath: null,
    });
  });

  it('replaces a stale cached copy with what is on disk', async () => {
    useVaultStore.setState({ noteCache: new Map([['garden.md', cached('garden.md', '# Garden\n')]]) });
    disk.set('garden.md', '# Garden\n\n## Quick note · 2026-06-09 14:32\n\nprune\n');

    await useVaultStore.getState().reloadNote('garden.md');

    const note = useVaultStore.getState().noteCache.get('garden.md')!;
    expect(note.content).toContain('## Quick note');
    expect(note.disk_hash).toBe(`hash:${disk.get('garden.md')}`);
  });

  it('leaves notes that were never opened alone', async () => {
    disk.set('other.md', 'x');
    await useVaultStore.getState().reloadNote('other.md');
    expect(useVaultStore.getState().noteCache.has('other.md')).toBe(false);
  });

  it('forgets a deleted source without flushing its pending edits', () => {
    const path = 'quick/2026-06-09/14-32-08.md';
    useVaultStore.setState({
      noteCache: new Map([[path, cached(path, 'thought')]]),
      openTabs: [{ path, title: '14-32-08', isDirty: true, isPreview: false }],
      activeTabPath: path,
    });
    scheduleAutosave(path);

    useVaultStore.getState().forgetNote(path);

    const s = useVaultStore.getState();
    expect(hasPendingAutosave(path)).toBe(false);
    expect(s.noteCache.has(path)).toBe(false);
    expect(s.openTabs).toEqual([]);
    expect(s.activeTabPath).toBeNull();
  });
});
