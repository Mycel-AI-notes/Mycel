/**
 * The command registry's vocabulary: what a command is, how a hotkey is
 * spelled, and how user overrides combine with the defaults.
 *
 * Hotkeys used to be a chain of `if (e.key === 'o')` branches in `App.tsx`,
 * which meant the shortcuts table in the README, the tooltips and the
 * handler could each drift on their own, and nothing could list "everything
 * the app can do". Now a command is declared once — id, title, default
 * hotkey, run — and the palette, the key handler and the settings screen all
 * read the same list.
 *
 * Everything in this file is pure (no React, no stores, no DOM) so the
 * parsing and conflict rules can be unit tested. The actual commands live in
 * `app-commands.ts`, which is where the stores come in.
 */

export interface Command {
  /** Stable id. Persisted in hotkey overrides — never rename one casually. */
  id: string;
  title: string;
  /** Groups rows in the palette and the hotkey settings ("Garden", "Notes"…). */
  section?: string;
  /** Canonical hotkey (see `normalizeHotkey`), e.g. `Mod+Shift+P`. */
  defaultHotkey?: string;
  /**
   * An OS-wide shortcut registered through the global-shortcut plugin rather
   * than the in-window key handler. Shown in the palette, but not rebindable:
   * re-registering a global shortcut at runtime is a different lifecycle, and
   * the in-window handler must not fire it a second time.
   */
  global?: boolean;
  /** False when the command makes no sense right now (Garden switched off,
   *  no presentable note…). Hidden from the palette, ignored by hotkeys. */
  enabled?: () => boolean;
  run: () => void;
}

/** A hotkey binding per command id; `null` means "no hotkey". */
export type Bindings = Record<string, string | null>;

/** User overrides by command id. `null` is an explicit unbind, distinct from
 *  "absent", which means "use the default". */
export type HotkeyOverrides = Record<string, string | null>;

const MODIFIER_ORDER = ['Mod', 'Ctrl', 'Alt', 'Shift'] as const;
type Modifier = (typeof MODIFIER_ORDER)[number];

const MODIFIER_ALIASES: Record<string, Modifier> = {
  mod: 'Mod',
  cmd: 'Mod',
  command: 'Mod',
  commandorcontrol: 'Mod',
  ctrl: 'Ctrl',
  control: 'Ctrl',
  alt: 'Alt',
  option: 'Alt',
  shift: 'Shift',
};

/** `KeyboardEvent.code` values for punctuation, mapped to the character the
 *  key carries on a US layout. Reading `code` rather than `key` keeps a
 *  binding working when the user switches to a non-Latin layout: `⌘P` on a
 *  Russian layout reports `key: 'з'` but still `code: 'KeyP'`. */
const CODE_TO_KEY: Record<string, string> = {
  Backquote: '`',
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
};

const NAMED_KEYS: Record<string, string> = {
  ' ': 'Space',
  space: 'Space',
  esc: 'Escape',
  escape: 'Escape',
  enter: 'Enter',
  tab: 'Tab',
  backspace: 'Backspace',
  delete: 'Delete',
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  home: 'Home',
  end: 'End',
  pageup: 'PageUp',
  pagedown: 'PageDown',
};

function normalizeKey(key: string): string | null {
  if (!key) return null;
  const named = NAMED_KEYS[key.toLowerCase()];
  if (named) return named;
  if (/^f([1-9]|1[0-9]|2[0-4])$/i.test(key)) return key.toUpperCase();
  if (key.length === 1) return key.toUpperCase();
  return null;
}

/**
 * Canonical spelling of a hotkey: modifiers in a fixed order, then the key,
 * joined with `+` — `Mod+Shift+P`. Accepts loose input (`shift+cmd+p`,
 * `CommandOrControl+N`). Returns `null` for anything that is not exactly one
 * key plus modifiers.
 */
export function normalizeHotkey(input: string): string | null {
  const parts = input
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  const mods = new Set<Modifier>();
  let key: string | null = null;
  for (const part of parts) {
    const mod = MODIFIER_ALIASES[part.toLowerCase()];
    if (mod) {
      mods.add(mod);
      continue;
    }
    if (key !== null) return null; // two non-modifier keys
    key = normalizeKey(part);
    if (key === null) return null;
  }
  if (key === null) return null;
  return [...MODIFIER_ORDER.filter((m) => mods.has(m)), key].join('+');
}

/** The subset of `KeyboardEvent` the hotkey code reads. */
export interface KeyLike {
  key: string;
  code?: string;
  metaKey: boolean;
  ctrlKey: boolean;
  altKey: boolean;
  shiftKey: boolean;
}

/**
 * The canonical hotkey a key event represents, or `null` while only
 * modifiers are held. `Mod` is ⌘ on macOS and Ctrl elsewhere; on macOS a held
 * Ctrl is reported separately as `Ctrl`.
 */
export function eventToHotkey(e: KeyLike, isMac: boolean): string | null {
  if (['Shift', 'Control', 'Alt', 'Meta', 'OS', 'Hyper', 'Super'].includes(e.key)) {
    return null;
  }
  let key: string | null = null;
  const code = e.code ?? '';
  const letter = /^Key([A-Z])$/.exec(code);
  const digit = /^Digit([0-9])$/.exec(code);
  if (letter) key = letter[1];
  else if (digit) key = digit[1];
  else if (CODE_TO_KEY[code]) key = CODE_TO_KEY[code];
  else key = normalizeKey(e.key);
  if (key === null) return null;

  const mods: Modifier[] = [];
  if (isMac ? e.metaKey : e.ctrlKey) mods.push('Mod');
  if (isMac && e.ctrlKey) mods.push('Ctrl');
  if (e.altKey) mods.push('Alt');
  if (e.shiftKey) mods.push('Shift');
  return [...mods, key].join('+');
}

/**
 * Can this be a command hotkey? It needs a modifier other than Shift, or be a
 * function key — otherwise binding it would eat ordinary typing.
 */
export function isAssignableHotkey(hotkey: string): boolean {
  const parts = hotkey.split('+');
  const key = parts[parts.length - 1];
  if (/^F\d{1,2}$/.test(key)) return true;
  return parts.some((p) => p === 'Mod' || p === 'Ctrl' || p === 'Alt');
}

const MAC_SYMBOLS: Record<string, string> = {
  Mod: '⌘',
  Ctrl: '⌃',
  Alt: '⌥',
  Shift: '⇧',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Enter: '↩',
  Escape: 'Esc',
  Backspace: '⌫',
};

const PC_NAMES: Record<string, string> = {
  Mod: 'Ctrl',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Escape: 'Esc',
};

/** Human spelling for UI: `⌘⇧P` on macOS, `Ctrl+Shift+P` elsewhere. */
export function formatHotkey(hotkey: string, isMac: boolean): string {
  const parts = hotkey.split('+');
  if (isMac) return parts.map((p) => MAC_SYMBOLS[p] ?? p).join('');
  return parts.map((p) => PC_NAMES[p] ?? p).join('+');
}

/** Effective binding per command: the override when one exists (including an
 *  explicit `null` unbind), the default otherwise. Global commands ignore
 *  overrides — they are not rebindable. */
export function resolveBindings(commands: Command[], overrides: HotkeyOverrides): Bindings {
  const out: Bindings = {};
  for (const cmd of commands) {
    const override = cmd.global ? undefined : overrides[cmd.id];
    out[cmd.id] = override !== undefined ? override : (cmd.defaultHotkey ?? null);
  }
  return out;
}

/** Ids, other than `exceptId`, currently bound to `hotkey`. */
export function commandsBoundTo(bindings: Bindings, hotkey: string, exceptId?: string): string[] {
  return Object.entries(bindings)
    .filter(([id, hk]) => hk === hotkey && id !== exceptId)
    .map(([id]) => id);
}

/** Every hotkey bound to more than one command, with the ids sharing it. */
export function findConflicts(bindings: Bindings): Map<string, string[]> {
  const byKey = new Map<string, string[]>();
  for (const [id, hk] of Object.entries(bindings)) {
    if (!hk) continue;
    byKey.set(hk, [...(byKey.get(hk) ?? []), id]);
  }
  for (const [hk, ids] of byKey) {
    if (ids.length < 2) byKey.delete(hk);
  }
  return byKey;
}

/**
 * The command a key press should run: the first enabled, non-global command
 * bound to it. Global commands are skipped because the OS shortcut already
 * fires them, even while the window has focus.
 */
export function commandForHotkey(
  commands: Command[],
  bindings: Bindings,
  hotkey: string,
): Command | undefined {
  return commands.find(
    (c) => !c.global && bindings[c.id] === hotkey && (c.enabled?.() ?? true),
  );
}
