/**
 * Daily notes: one note per day at `<folder>/YYYY-MM-DD.md`.
 *
 * Pure helpers — naming, discovery, previous/next — kept apart from the
 * store-driven "open or create" action in `daily-actions.ts` so the date and
 * path rules are unit tested.
 */
import type { FileEntry } from '@/types';
import { formatDate, type TemplateFile } from './templates';

export const DEFAULT_DAILY_FOLDER = 'daily';

const DAILY_NAME_RE = /^(\d{4}-\d{2}-\d{2})\.md(?:\.age)?$/;

/** `YYYY-MM-DD` for `d` in local time — "today" is the user's today, not UTC's. */
export function dateKey(d: Date): string {
  return formatDate(d, 'YYYY-MM-DD');
}

/** Where the daily note for `d` lives (or would be created). */
export function dailyNotePath(folder: string, d: Date): string {
  return `${folder}/${dateKey(d)}.md`;
}

/** The `YYYY-MM-DD` a path names when it is a daily note directly inside
 *  `folder`, `null` otherwise. */
export function dailyNoteDate(path: string, folder: string): string | null {
  if (!path.startsWith(`${folder}/`)) return null;
  const rest = path.slice(folder.length + 1);
  const m = DAILY_NAME_RE.exec(rest);
  return m ? m[1] : null;
}

export interface DailyNote {
  date: string;
  path: string;
}

/**
 * Daily notes that exist in `folder`, oldest first. When a day has both a
 * plaintext and an encrypted copy (unusual, but sync can produce it), the
 * plaintext one wins.
 */
export function listDailyNotes(tree: FileEntry[], folder: string): DailyNote[] {
  const segments = folder.split('/');
  let level: FileEntry[] | undefined = tree;
  let walked = '';
  for (const seg of segments) {
    walked = walked ? `${walked}/${seg}` : seg;
    const dir: FileEntry | undefined = level?.find((e) => e.is_dir && e.path === walked);
    level = dir?.children;
    if (!level) return [];
  }
  const byDate = new Map<string, string>();
  for (const e of level) {
    if (e.is_dir) continue;
    const date = dailyNoteDate(e.path, folder);
    if (!date) continue;
    const prev = byDate.get(date);
    if (!prev || prev.endsWith('.md.age')) byDate.set(date, e.path);
  }
  return [...byDate.entries()]
    .map(([date, path]) => ({ date, path }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

/**
 * The nearest existing daily note before (`-1`) or after (`1`) `fromDate`.
 * Days without a note are skipped, as in Obsidian — "previous" means the
 * last day you wrote one, not literally yesterday.
 */
export function adjacentDailyNote(
  notes: DailyNote[],
  fromDate: string,
  direction: -1 | 1,
): DailyNote | null {
  if (direction < 0) {
    for (let i = notes.length - 1; i >= 0; i--) {
      if (notes[i].date < fromDate) return notes[i];
    }
    return null;
  }
  return notes.find((n) => n.date > fromDate) ?? null;
}

/**
 * The template a new daily note starts from: the configured path when one is
 * set (matched case-insensitively, `.md` optional), otherwise a template
 * named `daily` / `Daily note` in the templates folder. `null` means start
 * blank.
 */
export function findDailyTemplate(templates: TemplateFile[], configured: string): TemplateFile | null {
  const wanted = configured.trim().toLowerCase().replace(/\.md$/, '');
  if (wanted) {
    return (
      templates.find((t) => t.path.toLowerCase().replace(/\.md$/, '') === wanted) ??
      null
    );
  }
  return (
    templates.find((t) => ['daily', 'daily note'].includes(t.name.toLowerCase())) ?? null
  );
}
