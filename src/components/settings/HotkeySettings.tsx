import { useMemo, useState } from 'react';
import { RotateCcw } from 'lucide-react';
import { useUIStore } from '@/stores/ui';
import { getAppCommands } from '@/lib/app-commands';
import { checkRebind, eventToHotkey, findConflicts, formatHotkey, type Command } from '@/lib/commands';
import { isMac } from '@/lib/platform';
import { useHotkeyBindings } from '@/hooks/useHotkeyBindings';

/** A rebind that would take the hotkey away from other commands, parked
 *  until the user confirms. */
interface PendingSteal {
  id: string;
  hotkey: string;
  holders: string[];
}

/**
 * Settings → Hotkeys. Lists every command with its current binding; click a
 * binding and press the new keys to rebind. Backspace unbinds, Esc cancels.
 * A hotkey already held by another command asks before taking it, so two
 * commands never silently share one.
 *
 * The global quick-note shortcut is shown but not rebindable: it is an
 * OS-level registration with its own lifecycle (see `App.tsx`).
 */
export function HotkeySettings() {
  const commands = getAppCommands();
  const bindings = useHotkeyBindings();
  const overrides = useUIStore((s) => s.hotkeyOverrides);
  const setOverride = useUIStore((s) => s.setHotkeyOverride);
  const resetHotkey = useUIStore((s) => s.resetHotkey);

  const [capturing, setCapturing] = useState<string | null>(null);
  const [error, setError] = useState<{ id: string; text: string } | null>(null);
  const [pending, setPending] = useState<PendingSteal | null>(null);

  const titleOf = (id: string) => commands.find((c) => c.id === id)?.title ?? id;

  // Overrides persisted by an older build could still collide; flag them
  // rather than pretending all is well.
  const conflicted = useMemo(() => {
    const out = new Set<string>();
    for (const ids of findConflicts(bindings).values()) ids.forEach((id) => out.add(id));
    return out;
  }, [bindings]);

  const sections = useMemo(() => {
    const map = new Map<string, Command[]>();
    for (const c of commands) {
      const key = c.section ?? 'Other';
      map.set(key, [...(map.get(key) ?? []), c]);
    }
    return [...map.entries()];
  }, [commands]);

  const assign = (id: string, hotkey: string | null) => {
    const cmd = commands.find((c) => c.id === id);
    // Storing the default as an override would pin it against future
    // default changes; store "no override" instead.
    if (hotkey === (cmd?.defaultHotkey ?? null)) resetHotkey(id);
    else setOverride(id, hotkey);
  };

  const onCaptureKey = (id: string, e: React.KeyboardEvent) => {
    // Every key belongs to the capture — none may reach the app's hotkeys.
    e.preventDefault();
    e.stopPropagation();
    const plain = !e.metaKey && !e.ctrlKey && !e.altKey && !e.shiftKey;
    if (plain && e.key === 'Escape') {
      setCapturing(null);
      return;
    }
    if (plain && (e.key === 'Backspace' || e.key === 'Delete')) {
      assign(id, null);
      setCapturing(null);
      return;
    }
    const hotkey = eventToHotkey(e.nativeEvent, isMac);
    if (!hotkey) return; // only modifiers so far — keep listening
    const check = checkRebind(commands, bindings, id, hotkey);
    if (check.kind === 'invalid') {
      setError({ id, text: `${formatHotkey(hotkey, isMac)}: ${check.reason}` });
      return;
    }
    setCapturing(null);
    setError(null);
    if (check.kind === 'conflict') {
      setPending({ id, hotkey, holders: check.ids });
      return;
    }
    assign(id, hotkey);
  };

  const confirmSteal = () => {
    if (!pending) return;
    for (const holder of pending.holders) setOverride(holder, null);
    assign(pending.id, pending.hotkey);
    setPending(null);
  };

  return (
    <div className="flex flex-col gap-5">
      <p className="text-xs text-text-muted">
        Click a shortcut and press the new keys. <kbd>Backspace</kbd> removes it,{' '}
        <kbd>Esc</kbd> cancels. Every command is also in the palette.
      </p>

      {sections.map(([section, cmds]) => (
        <section key={section}>
          <h3 className="text-[10px] uppercase tracking-wider text-text-muted mb-1.5">{section}</h3>
          <ul className="flex flex-col">
            {cmds.map((c) => {
              const hk = bindings[c.id];
              const overridden = !c.global && overrides[c.id] !== undefined;
              const isCapturing = capturing === c.id;
              return (
                <li key={c.id} className="py-1.5 border-b border-border/50 last:border-b-0">
                  <div className="flex items-center gap-2">
                    <span className="flex-1 text-sm text-text-primary truncate">{c.title}</span>
                    {overridden && (
                      <button
                        type="button"
                        onClick={() => resetHotkey(c.id)}
                        className="p-1 rounded text-text-muted hover:text-text-primary hover:bg-surface-hover"
                        title={
                          c.defaultHotkey
                            ? `Reset to ${formatHotkey(c.defaultHotkey, isMac)}`
                            : 'Reset (no default hotkey)'
                        }
                      >
                        <RotateCcw size={12} />
                      </button>
                    )}
                    {c.global ? (
                      <span
                        className="text-[11px] text-text-muted px-2 py-0.5"
                        title="System-wide shortcut — not rebindable"
                      >
                        {hk ? formatHotkey(hk, isMac) : '—'} · global
                      </span>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setError(null);
                          setPending(null);
                          setCapturing(isCapturing ? null : c.id);
                        }}
                        onKeyDown={isCapturing ? (e) => onCaptureKey(c.id, e) : undefined}
                        onBlur={() => isCapturing && setCapturing(null)}
                        className={
                          'min-w-[6.5rem] text-[11px] px-2 py-0.5 rounded border transition-colors ' +
                          (isCapturing
                            ? 'border-accent text-accent bg-accent/10'
                            : conflicted.has(c.id)
                              ? 'border-error text-error'
                              : 'border-border text-text-secondary hover:bg-surface-hover')
                        }
                      >
                        {isCapturing ? 'Press keys…' : hk ? formatHotkey(hk, isMac) : '—'}
                      </button>
                    )}
                  </div>
                  {error?.id === c.id && (
                    <p className="text-[11px] text-error mt-1">{error.text}</p>
                  )}
                  {conflicted.has(c.id) && !pending && (
                    <p className="text-[11px] text-error mt-1">Shares its shortcut with another command.</p>
                  )}
                  {pending?.id === c.id && (
                    <div className="flex items-center gap-2 mt-1 text-[11px]">
                      <span className="text-warning flex-1">
                        {formatHotkey(pending.hotkey, isMac)} is used by{' '}
                        {pending.holders.map(titleOf).join(', ')}.
                      </span>
                      <button
                        type="button"
                        onClick={confirmSteal}
                        className="px-2 py-0.5 rounded border border-border hover:bg-surface-hover text-text-primary"
                      >
                        Reassign
                      </button>
                      <button
                        type="button"
                        onClick={() => setPending(null)}
                        className="px-2 py-0.5 rounded text-text-muted hover:text-text-primary"
                      >
                        Cancel
                      </button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
