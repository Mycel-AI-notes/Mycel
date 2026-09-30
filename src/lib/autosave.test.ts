import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { EditorView } from '@codemirror/view';
import { registerEditorView, unregisterEditorView } from './editor-registry';
import {
  AUTOSAVE_DEBOUNCE_MS,
  cancelAutosave,
  configureAutosave,
  flushAllAutosaves,
  flushAutosave,
  hasPendingAutosave,
  remapAutosave,
  scheduleAutosave,
} from './autosave';

/**
 * A stand-in for a mounted CodeMirror view. Autosave only ever reads
 * `state.doc.toString()`, so that is all this needs to provide — building a
 * real view would need a DOM.
 */
function fakeView(text: string) {
  const view = {
    state: { doc: { toString: () => view._text } },
    _text: text,
  };
  return view as unknown as EditorView & { _text: string };
}

function mount(path: string, text: string) {
  const view = fakeView(text);
  registerEditorView(path, view);
  return {
    view,
    type: (next: string) => {
      (view as unknown as { _text: string })._text = next;
    },
    unmount: () => unregisterEditorView(path, view),
  };
}

describe('autosave', () => {
  let saved: Array<[string, string]>;
  let save: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.useFakeTimers();
    saved = [];
    save = vi.fn(async (path: string, content: string) => {
      saved.push([path, content]);
    });
    configureAutosave(save as unknown as (p: string, c: string) => Promise<void>);
  });

  it('writes after the debounce elapses', async () => {
    const editor = mount('a.md', 'hello');
    scheduleAutosave('a.md');

    expect(save).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);

    expect(saved).toEqual([['a.md', 'hello']]);
    editor.unmount();
  });

  it('coalesces a burst of keystrokes into one write', async () => {
    const editor = mount('a.md', '');
    for (const text of ['h', 'he', 'hel', 'hell', 'hello']) {
      editor.type(text);
      scheduleAutosave('a.md');
      await vi.advanceTimersByTimeAsync(50);
    }
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);

    expect(save).toHaveBeenCalledTimes(1);
    expect(saved[0][1]).toBe('hello');
    editor.unmount();
  });

  it('writes the newest text, not the text at schedule time', async () => {
    // The user keeps typing while the timer runs; the last keystroke has to be
    // in the write.
    const editor = mount('a.md', 'first');
    scheduleAutosave('a.md');
    editor.type('second');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);

    expect(saved).toEqual([['a.md', 'second']]);
    editor.unmount();
  });

  it('keeps separate timers per note', async () => {
    const a = mount('a.md', 'A');
    const b = mount('b.md', 'B');

    scheduleAutosave('a.md');
    await vi.advanceTimersByTimeAsync(600);
    // Editing b must not cancel a's pending write.
    scheduleAutosave('b.md');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);

    expect(saved.map(([p]) => p).sort()).toEqual(['a.md', 'b.md']);
    a.unmount();
    b.unmount();
  });

  it('flush writes immediately without waiting for the timer', async () => {
    const editor = mount('a.md', 'urgent');
    scheduleAutosave('a.md');

    await flushAutosave('a.md');

    expect(saved).toEqual([['a.md', 'urgent']]);
    // The timer must not fire a second write.
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);
    expect(save).toHaveBeenCalledTimes(1);
    editor.unmount();
  });

  it('flush is a no-op when nothing is pending', async () => {
    const editor = mount('a.md', 'x');
    await flushAutosave('a.md');
    expect(save).not.toHaveBeenCalled();
    editor.unmount();
  });

  it('flushAll writes every pending note', async () => {
    // This is the window-close path: everything outstanding has to land.
    const a = mount('a.md', 'A');
    const b = mount('b.md', 'B');
    scheduleAutosave('a.md');
    scheduleAutosave('b.md');

    await flushAllAutosaves();

    expect(saved.map(([p]) => p).sort()).toEqual(['a.md', 'b.md']);
    a.unmount();
    b.unmount();
  });

  it('cancel drops pending edits without writing', async () => {
    // Used on delete: an autosave firing afterwards would recreate the note.
    const editor = mount('a.md', 'doomed');
    scheduleAutosave('a.md');

    cancelAutosave('a.md');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS * 2);

    expect(save).not.toHaveBeenCalled();
    expect(hasPendingAutosave('a.md')).toBe(false);
    editor.unmount();
  });

  it('remap moves pending edits to the new path', async () => {
    const old = mount('old.md', 'body');
    scheduleAutosave('old.md');

    remapAutosave('old.md', 'new.md');
    expect(hasPendingAutosave('old.md')).toBe(false);
    expect(hasPendingAutosave('new.md')).toBe(true);

    // The editor registry is remapped by the store; mount the new path here.
    old.unmount();
    const renamed = mount('new.md', 'body');
    await flushAutosave('new.md');

    expect(saved).toEqual([['new.md', 'body']]);
    renamed.unmount();
  });

  it('does not write a stale snapshot when the editor is gone', async () => {
    const editor = mount('a.md', 'text');
    scheduleAutosave('a.md');
    editor.unmount();

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);

    expect(save).not.toHaveBeenCalled();
    expect(hasPendingAutosave('a.md')).toBe(false);
  });

  it('keeps the note pending when the write fails so a later flush retries', async () => {
    const editor = mount('a.md', 'text');
    save.mockRejectedValueOnce(new Error('disk full'));

    scheduleAutosave('a.md');
    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);

    expect(save).toHaveBeenCalledTimes(1);
    expect(hasPendingAutosave('a.md')).toBe(true);

    await flushAutosave('a.md');
    expect(saved).toEqual([['a.md', 'text']]);
    editor.unmount();
  });

  it('reports nothing pending once a write succeeds', async () => {
    const editor = mount('a.md', 'text');
    scheduleAutosave('a.md');
    expect(hasPendingAutosave('a.md')).toBe(true);

    await vi.advanceTimersByTimeAsync(AUTOSAVE_DEBOUNCE_MS);

    expect(hasPendingAutosave('a.md')).toBe(false);
    editor.unmount();
  });
});
