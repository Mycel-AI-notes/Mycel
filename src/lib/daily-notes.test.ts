import { describe, expect, it } from 'vitest';
import type { FileEntry } from '@/types';
import {
  adjacentDailyNote,
  dailyNoteDate,
  dailyNotePath,
  dateKey,
  findDailyTemplate,
  listDailyNotes,
} from './daily-notes';

const file = (path: string): FileEntry => ({ name: path.split('/').pop()!, path, is_dir: false });
const dir = (path: string, children: FileEntry[]): FileEntry => ({
  name: path.split('/').pop()!,
  path,
  is_dir: true,
  children,
});

describe('naming', () => {
  it('uses the local date, zero-padded', () => {
    const d = new Date(2026, 0, 5, 23, 59);
    expect(dateKey(d)).toBe('2026-01-05');
    expect(dailyNotePath('daily', d)).toBe('daily/2026-01-05.md');
    expect(dailyNotePath('journal/days', d)).toBe('journal/days/2026-01-05.md');
  });

  it('recognises a daily note only directly inside the folder', () => {
    expect(dailyNoteDate('daily/2026-01-05.md', 'daily')).toBe('2026-01-05');
    expect(dailyNoteDate('daily/2026-01-05.md.age', 'daily')).toBe('2026-01-05');
    expect(dailyNoteDate('daily/sub/2026-01-05.md', 'daily')).toBeNull();
    expect(dailyNoteDate('daily/2026-01-05 notes.md', 'daily')).toBeNull();
    expect(dailyNoteDate('dailyx/2026-01-05.md', 'daily')).toBeNull();
    expect(dailyNoteDate('2026-01-05.md', 'daily')).toBeNull();
  });
});

describe('listDailyNotes', () => {
  const tree: FileEntry[] = [
    dir('daily', [
      file('daily/2026-01-07.md'),
      file('daily/2026-01-05.md'),
      file('daily/2026-01-06.md.age'),
      file('daily/2026-01-07.md.age'),
      file('daily/ideas.md'),
      dir('daily/archive', [file('daily/archive/2025-12-31.md')]),
    ]),
    dir('journal', [dir('journal/days', [file('journal/days/2026-02-01.md')])]),
  ];

  it('lists dated notes oldest first, preferring plaintext on a tie', () => {
    expect(listDailyNotes(tree, 'daily')).toEqual([
      { date: '2026-01-05', path: 'daily/2026-01-05.md' },
      { date: '2026-01-06', path: 'daily/2026-01-06.md.age' },
      { date: '2026-01-07', path: 'daily/2026-01-07.md' },
    ]);
  });

  it('walks into a nested folder', () => {
    expect(listDailyNotes(tree, 'journal/days')).toEqual([
      { date: '2026-02-01', path: 'journal/days/2026-02-01.md' },
    ]);
  });

  it('is empty when the folder does not exist yet', () => {
    expect(listDailyNotes(tree, 'nope')).toEqual([]);
    expect(listDailyNotes(tree, 'journal/nope')).toEqual([]);
  });
});

describe('adjacentDailyNote', () => {
  const notes = [
    { date: '2026-01-01', path: 'a' },
    { date: '2026-01-04', path: 'b' },
    { date: '2026-01-09', path: 'c' },
  ];

  it('skips days without a note', () => {
    expect(adjacentDailyNote(notes, '2026-01-09', -1)?.path).toBe('b');
    expect(adjacentDailyNote(notes, '2026-01-04', 1)?.path).toBe('c');
  });

  it('works from a day that has no note itself', () => {
    expect(adjacentDailyNote(notes, '2026-01-06', -1)?.path).toBe('b');
    expect(adjacentDailyNote(notes, '2026-01-06', 1)?.path).toBe('c');
  });

  it('is null past either end', () => {
    expect(adjacentDailyNote(notes, '2026-01-01', -1)).toBeNull();
    expect(adjacentDailyNote(notes, '2026-01-09', 1)).toBeNull();
    expect(adjacentDailyNote([], '2026-01-09', 1)).toBeNull();
  });
});

describe('findDailyTemplate', () => {
  const templates = [
    { path: 'templates/Daily.md', name: 'Daily' },
    { path: 'templates/Meeting.md', name: 'Meeting' },
  ];

  it('finds a template named "daily" when none is configured', () => {
    expect(findDailyTemplate(templates, '')?.path).toBe('templates/Daily.md');
  });

  it('honours a configured path, case-insensitively and with or without .md', () => {
    expect(findDailyTemplate(templates, 'templates/meeting')?.path).toBe('templates/Meeting.md');
    expect(findDailyTemplate(templates, 'Templates/Meeting.md')?.path).toBe('templates/Meeting.md');
  });

  it('starts blank when nothing fits', () => {
    expect(findDailyTemplate(templates, 'templates/missing')).toBeNull();
    expect(findDailyTemplate([templates[1]], '')).toBeNull();
  });
});
