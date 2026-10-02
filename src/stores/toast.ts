import { create } from 'zustand';

export type ToastKind = 'error' | 'info' | 'success';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

/**
 * How long a toast stays up. Errors linger: a failed save is something the
 * user has to act on, and 3 seconds is not enough to read a path and decide.
 */
const TTL_MS: Record<ToastKind, number> = {
  error: 9000,
  info: 4000,
  success: 3000,
};

interface ToastState {
  toasts: Toast[];
  push: (kind: ToastKind, message: string) => number;
  /** Shorthand for the common case — something failed and the user must know. */
  error: (message: string) => number;
  info: (message: string) => number;
  success: (message: string) => number;
  dismiss: (id: number) => void;
}

let nextId = 1;

/**
 * Transient user-facing messages.
 *
 * Added because the app had nowhere to report a failure. A failed save was a
 * `console.error` behind the devtools: the editor kept the text, the tab kept
 * its dirty dot, and nothing said the write had not happened — so "I pressed
 * save" and "it is on disk" looked identical. Anything the user needs to know
 * about now goes through here.
 */
export const useToastStore = create<ToastState>((set, get) => ({
  toasts: [],

  push: (kind, message) => {
    const id = nextId++;
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    // Errors auto-dismiss too, so a burst cannot wedge the corner of the
    // screen; the user can also close them by hand.
    setTimeout(() => get().dismiss(id), TTL_MS[kind]);
    return id;
  },

  error: (message) => get().push('error', message),
  info: (message) => get().push('info', message),
  success: (message) => get().push('success', message),

  dismiss: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));

/**
 * Turn whatever a Tauri command rejected with into something readable. The IPC
 * bridge rejects with a plain string for our `Err(String)` commands, but an
 * Error or a serialized object can come through too.
 */
export function describeError(e: unknown): string {
  if (typeof e === 'string') return e;
  if (e instanceof Error) return e.message;
  if (e && typeof e === 'object' && 'message' in e) {
    const m = (e as { message: unknown }).message;
    if (typeof m === 'string') return m;
  }
  return String(e);
}
