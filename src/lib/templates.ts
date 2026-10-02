/**
 * Note templates: plain `.md` files in a folder (default `templates/`) whose
 * text is inserted with a few variables filled in.
 *
 * Variables follow Obsidian's core Templates plugin so a template folder
 * brought over from there keeps working:
 *
 * - `{{title}}` — the name of the note the template lands in
 * - `{{date}}` — `YYYY-MM-DD`
 * - `{{time}}` — `HH:mm`
 * - `{{date:FORMAT}}` / `{{time:FORMAT}}` — FORMAT built from the tokens
 *   `YYYY MM DD HH mm`; anything else in FORMAT is copied as-is
 *
 * An unknown `{{variable}}` is left untouched rather than blanked: a template
 * may be meant for some other tool, and silently deleting text is worse than
 * leaving a placeholder the user can see.
 *
 * Pure — no stores, no Tauri — so the substitution rules are unit tested.
 */
import type { FileEntry } from '@/types';
import { displayName } from './note-name';

export const DEFAULT_TEMPLATES_FOLDER = 'templates';

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * Format `d` (local time) with the `YYYY MM DD HH mm` tokens. Longest tokens
 * are matched first so `MM` (month) and `mm` (minutes) never collide.
 */
export function formatDate(d: Date, format: string): string {
  const tokens: Record<string, string> = {
    YYYY: String(d.getFullYear()),
    MM: pad(d.getMonth() + 1),
    DD: pad(d.getDate()),
    HH: pad(d.getHours()),
    mm: pad(d.getMinutes()),
  };
  return format.replace(/YYYY|MM|DD|HH|mm/g, (t) => tokens[t]);
}

export interface TemplateContext {
  /** When the template is being applied. */
  now: Date;
  /** Name of the note the template is inserted into. */
  title: string;
}

/** Fill in the template variables. See the module doc for the set. */
export function applyTemplate(text: string, ctx: TemplateContext): string {
  return text.replace(/\{\{\s*(\w+)(?::([^}]*))?\s*\}\}/g, (whole, name: string, format?: string) => {
    switch (name.toLowerCase()) {
      case 'title':
        return ctx.title;
      case 'date':
        return formatDate(ctx.now, format?.trim() || 'YYYY-MM-DD');
      case 'time':
        return formatDate(ctx.now, format?.trim() || 'HH:mm');
      default:
        return whole;
    }
  });
}

/**
 * Tidy a user-entered vault folder: trim whitespace and slashes. Returns
 * `null` for anything that could escape the vault or is not a plain relative
 * folder (`..`, `.`, empty segments, backslashes, drive letters).
 */
export function normalizeFolder(input: string): string | null {
  const trimmed = input.trim().replace(/^\/+|\/+$/g, '');
  if (!trimmed) return null;
  if (trimmed.includes('\\') || trimmed.includes(':')) return null;
  if (trimmed.split('/').some((s) => s === '' || s === '.' || s === '..')) return null;
  return trimmed;
}

export interface TemplateFile {
  path: string;
  /** File name without `.md` — what the picker shows. */
  name: string;
}

/**
 * Every `.md` file at or below `folder` in the vault tree, sorted by path.
 * Encrypted (`.md.age`) notes are skipped: reading one needs the vault
 * unlocked, and a template is meant to be boilerplate, not a secret.
 */
export function listTemplates(tree: FileEntry[], folder: string): TemplateFile[] {
  const out: TemplateFile[] = [];
  const prefix = `${folder}/`;
  const walk = (entries: FileEntry[]) => {
    for (const e of entries) {
      if (e.is_dir) {
        // Only descend where the folder could be: an ancestor of it or
        // something inside it.
        if (folder.startsWith(`${e.path}/`) || e.path === folder || e.path.startsWith(prefix)) {
          walk(e.children ?? []);
        }
        continue;
      }
      if (e.path.startsWith(prefix) && e.path.endsWith('.md')) {
        out.push({ path: e.path, name: displayName(e.path) });
      }
    }
  };
  walk(tree);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
