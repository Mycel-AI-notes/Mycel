import { describe, expect, it } from 'vitest';
import {
  checkRebind,
  commandForHotkey,
  commandsBoundTo,
  eventToHotkey,
  findConflicts,
  formatHotkey,
  isAssignableHotkey,
  normalizeHotkey,
  resolveBindings,
  type Command,
  type KeyLike,
} from './commands';

const key = (over: Partial<KeyLike>): KeyLike => ({
  key: '',
  code: '',
  metaKey: false,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  ...over,
});

const cmd = (id: string, over: Partial<Command> = {}): Command => ({
  id,
  title: id,
  run: () => undefined,
  ...over,
});

describe('normalizeHotkey', () => {
  it('orders modifiers canonically and uppercases letters', () => {
    expect(normalizeHotkey('shift+mod+p')).toBe('Mod+Shift+P');
  });

  it('accepts the global-shortcut spelling', () => {
    expect(normalizeHotkey('CommandOrControl+Shift+N')).toBe('Mod+Shift+N');
  });

  it('keeps punctuation and named keys', () => {
    expect(normalizeHotkey('Mod+`')).toBe('Mod+`');
    expect(normalizeHotkey('alt+arrowup')).toBe('Alt+ArrowUp');
    expect(normalizeHotkey('f5')).toBe('F5');
  });

  it('rejects two keys, no key, or nonsense', () => {
    expect(normalizeHotkey('Mod+A+B')).toBeNull();
    expect(normalizeHotkey('Mod+Shift')).toBeNull();
    expect(normalizeHotkey('Mod+Banana')).toBeNull();
    expect(normalizeHotkey('')).toBeNull();
  });
});

describe('eventToHotkey', () => {
  it('maps ⌘ to Mod on macOS and Ctrl to Mod elsewhere', () => {
    expect(eventToHotkey(key({ key: 'p', code: 'KeyP', metaKey: true }), true)).toBe('Mod+P');
    expect(eventToHotkey(key({ key: 'p', code: 'KeyP', ctrlKey: true }), false)).toBe('Mod+P');
  });

  it('reports a macOS Ctrl separately from ⌘', () => {
    expect(eventToHotkey(key({ key: 'p', code: 'KeyP', ctrlKey: true }), true)).toBe('Ctrl+P');
  });

  it('reads the physical key, so a non-Latin layout still matches', () => {
    // ⌘⇧P on a Russian layout: `key` is the Cyrillic letter.
    const e = key({ key: 'З', code: 'KeyP', metaKey: true, shiftKey: true });
    expect(eventToHotkey(e, true)).toBe('Mod+Shift+P');
  });

  it('maps punctuation by code', () => {
    expect(eventToHotkey(key({ key: '~', code: 'Backquote', ctrlKey: true }), false)).toBe('Mod+`');
    expect(eventToHotkey(key({ key: ',', code: 'Comma', metaKey: true }), true)).toBe('Mod+,');
  });

  it('is null while only modifiers are held', () => {
    expect(eventToHotkey(key({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }), true)).toBeNull();
    expect(eventToHotkey(key({ key: 'Meta', code: 'MetaLeft', metaKey: true }), true)).toBeNull();
  });

  it('falls back to `key` when there is no usable code', () => {
    expect(eventToHotkey(key({ key: 'F5' }), false)).toBe('F5');
    expect(eventToHotkey(key({ key: 'ArrowDown', altKey: true }), false)).toBe('Alt+ArrowDown');
  });
});

describe('isAssignableHotkey', () => {
  it('needs a real modifier or a function key', () => {
    expect(isAssignableHotkey('Mod+P')).toBe(true);
    expect(isAssignableHotkey('Alt+X')).toBe(true);
    expect(isAssignableHotkey('F5')).toBe(true);
    expect(isAssignableHotkey('P')).toBe(false);
    expect(isAssignableHotkey('Shift+P')).toBe(false);
  });
});

describe('formatHotkey', () => {
  it('uses symbols on macOS', () => {
    expect(formatHotkey('Mod+Shift+P', true)).toBe('⌘⇧P');
    expect(formatHotkey('Mod+Ctrl+Alt+K', true)).toBe('⌘⌃⌥K');
  });

  it('spells modifiers out elsewhere', () => {
    expect(formatHotkey('Mod+Shift+P', false)).toBe('Ctrl+Shift+P');
    expect(formatHotkey('Alt+ArrowUp', false)).toBe('Alt+↑');
  });
});

describe('resolveBindings', () => {
  const commands = [
    cmd('a', { defaultHotkey: 'Mod+A' }),
    cmd('b', { defaultHotkey: 'Mod+B' }),
    cmd('c'),
    cmd('g', { defaultHotkey: 'Mod+Shift+N', global: true }),
  ];

  it('uses defaults when there are no overrides', () => {
    expect(resolveBindings(commands, {})).toEqual({
      a: 'Mod+A',
      b: 'Mod+B',
      c: null,
      g: 'Mod+Shift+N',
    });
  });

  it('applies an override and an explicit unbind', () => {
    const out = resolveBindings(commands, { a: 'Mod+K', b: null, c: 'F2' });
    expect(out).toMatchObject({ a: 'Mod+K', b: null, c: 'F2' });
  });

  it('ignores overrides for global commands', () => {
    expect(resolveBindings(commands, { g: 'Mod+J' }).g).toBe('Mod+Shift+N');
  });
});

describe('conflicts', () => {
  it('lists every hotkey shared by more than one command', () => {
    const found = findConflicts({ a: 'Mod+K', b: 'Mod+K', c: 'Mod+J', d: null });
    expect([...found.entries()]).toEqual([['Mod+K', ['a', 'b']]]);
  });

  it('finds who else holds a hotkey', () => {
    const bindings = { a: 'Mod+K', b: 'Mod+K', c: 'Mod+J' };
    expect(commandsBoundTo(bindings, 'Mod+K', 'a')).toEqual(['b']);
    expect(commandsBoundTo(bindings, 'Mod+X')).toEqual([]);
  });
});

describe('commandForHotkey', () => {
  it('skips disabled and global commands', () => {
    const commands = [
      cmd('off', { enabled: () => false }),
      cmd('global', { global: true }),
      cmd('on'),
    ];
    const bindings = { off: 'Mod+K', global: 'Mod+K', on: 'Mod+K' };
    expect(commandForHotkey(commands, bindings, 'Mod+K')?.id).toBe('on');
  });

  it('finds nothing for an unbound key', () => {
    expect(commandForHotkey([cmd('a')], { a: null }, 'Mod+K')).toBeUndefined();
  });
});

describe('checkRebind', () => {
  const commands = [
    cmd('a'),
    cmd('b', { defaultHotkey: 'Mod+K' }),
    cmd('quick', { defaultHotkey: 'Mod+Shift+N', global: true }),
  ];
  const bindings = { a: null, b: 'Mod+K', quick: 'Mod+Shift+N' };

  it('accepts a free hotkey', () => {
    expect(checkRebind(commands, bindings, 'a', 'Mod+J')).toEqual({ kind: 'ok' });
  });

  it('reports the commands already holding it', () => {
    expect(checkRebind(commands, bindings, 'a', 'Mod+K')).toEqual({ kind: 'conflict', ids: ['b'] });
  });

  it('re-pressing a command\'s own hotkey is not a conflict', () => {
    expect(checkRebind(commands, bindings, 'b', 'Mod+K')).toEqual({ kind: 'ok' });
  });

  it('refuses a global shortcut, editor keys and bare keys', () => {
    expect(checkRebind(commands, bindings, 'a', 'Mod+Shift+N').kind).toBe('invalid');
    expect(checkRebind(commands, bindings, 'a', 'Mod+Z').kind).toBe('invalid');
    expect(checkRebind(commands, bindings, 'a', 'K').kind).toBe('invalid');
  });
});
