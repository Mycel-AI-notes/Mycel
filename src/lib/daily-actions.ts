/**
 * The daily-note commands: open (or create) today's note, and step to the
 * previous / next one. The rules — paths, which day is adjacent, which
 * template — are in `daily-notes.ts`; this file wires them to the stores.
 */
import { invoke } from '@tauri-apps/api/core';
import { useUIStore } from '@/stores/ui';
import { useVaultStore } from '@/stores/vault';
import { describeError, useToastStore } from '@/stores/toast';
import type { Note } from '@/types';
import {
  adjacentDailyNote,
  dailyNoteDate,
  dailyNotePath,
  dateKey,
  findDailyTemplate,
  listDailyNotes,
} from './daily-notes';
import { applyTemplate, listTemplates } from './templates';

/** The daily template's text with variables filled, or `undefined` to let
 *  the backend start the note with a plain heading. */
async function renderDailyTemplate(date: Date): Promise<string | undefined> {
  const { templatesFolder, dailyTemplate } = useUIStore.getState();
  const templates = listTemplates(useVaultStore.getState().fileTree, templatesFolder);
  const template = findDailyTemplate(templates, dailyTemplate);
  if (!template) return undefined;
  try {
    const note = await invoke<Note>('note_read', { path: template.path });
    return applyTemplate(note.content, { now: date, title: dateKey(date) });
  } catch (e) {
    // A broken template should not stop the user from journaling.
    useToastStore
      .getState()
      .info(`Daily template could not be read (${describeError(e)}) — started blank`);
    return undefined;
  }
}

/**
 * Open the daily note for `date` (today by default), creating it first when
 * missing. Creation goes through `note_create`, which refuses an existing
 * path; if the tree was stale and the file turns out to exist, we open it
 * rather than report an error — the user asked for that note either way.
 */
export async function openDailyNote(date: Date = new Date()): Promise<void> {
  const vault = useVaultStore.getState();
  if (!vault.vaultRoot) return;
  const folder = useUIStore.getState().dailyFolder;
  const key = dateKey(date);

  const existing = listDailyNotes(vault.fileTree, folder).find((n) => n.date === key);
  if (existing) {
    await vault.openNote(existing.path);
    return;
  }

  const path = dailyNotePath(folder, date);
  const content = await renderDailyTemplate(date);
  try {
    await vault.createNote(path, content);
  } catch (createErr) {
    try {
      await vault.openNote(path);
    } catch {
      useToastStore
        .getState()
        .error(`Could not create ${path}: ${describeError(createErr)}`);
    }
  }
}

/** Step to the nearest existing daily note before or after the one open —
 *  or before/after today when the active tab is not a daily note. */
export async function openAdjacentDailyNote(direction: -1 | 1): Promise<void> {
  const vault = useVaultStore.getState();
  if (!vault.vaultRoot) return;
  const folder = useUIStore.getState().dailyFolder;
  const from =
    (vault.activeTabPath && dailyNoteDate(vault.activeTabPath, folder)) || dateKey(new Date());
  const target = adjacentDailyNote(listDailyNotes(vault.fileTree, folder), from, direction);
  if (!target) {
    useToastStore
      .getState()
      .info(direction < 0 ? 'No earlier daily note' : 'No later daily note');
    return;
  }
  await vault.openNote(target.path);
}
