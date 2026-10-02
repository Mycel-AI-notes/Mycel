import { describe, expect, it } from 'vitest';
import type { FileEntry } from '@/types';
import { applyTemplate, formatDate, listTemplates, normalizeFolder } from './templates';

// 2026-03-07 09:05 local time — single-digit month, day, hour and minute so
// every zero-pad is exercised.
const now = new Date(2026, 2, 7, 9, 5);
const ctx = { now, title: 'Meeting notes' };

describe('formatDate', () => {
  it('fills every token, zero-padded', () => {
    expect(formatDate(now, 'YYYY-MM-DD HH:mm')).toBe('2026-03-07 09:05');
  });

  it('tells months (MM) from minutes (mm)', () => {
    expect(formatDate(now, 'MM/mm')).toBe('03/05');
  });

  it('copies anything that is not a token', () => {
    expect(formatDate(now, 'DD.MM.YYYY, week of')).toBe('07.03.2026, week of');
  });
});

describe('applyTemplate', () => {
  it('fills title, date and time', () => {
    const out = applyTemplate('# {{title}}\nCreated {{date}} at {{time}}', ctx);
    expect(out).toBe('# Meeting notes\nCreated 2026-03-07 at 09:05');
  });

  it('honours a custom date format', () => {
    expect(applyTemplate('{{date:DD.MM.YYYY}}', ctx)).toBe('07.03.2026');
    expect(applyTemplate('{{time:HH.mm}}', ctx)).toBe('09.05');
  });

  it('tolerates whitespace and case inside the braces', () => {
    expect(applyTemplate('{{ Title }} {{ DATE }}', ctx)).toBe('Meeting notes 2026-03-07');
  });

  it('replaces every occurrence', () => {
    expect(applyTemplate('{{title}} / {{title}}', ctx)).toBe('Meeting notes / Meeting notes');
  });

  it('leaves unknown variables visible instead of deleting them', () => {
    expect(applyTemplate('Hi {{author}} {{date}}', ctx)).toBe('Hi {{author}} 2026-03-07');
  });

  it('does not touch single braces or unclosed placeholders', () => {
    expect(applyTemplate('{title} {{date', ctx)).toBe('{title} {{date');
  });

  it('a title containing `$` survives replacement verbatim', () => {
    // A string replacement would expand `$&`; the function form must not.
    expect(applyTemplate('{{title}}', { now, title: 'Cost $& more' })).toBe('Cost $& more');
  });
});

describe('normalizeFolder', () => {
  it('trims whitespace and surrounding slashes', () => {
    expect(normalizeFolder('  /templates/ ')).toBe('templates');
    expect(normalizeFolder('meta/templates')).toBe('meta/templates');
  });

  it('refuses paths that could leave the vault or are empty', () => {
    expect(normalizeFolder('../outside')).toBeNull();
    expect(normalizeFolder('a//b')).toBeNull();
    expect(normalizeFolder('C:\\x')).toBeNull();
    expect(normalizeFolder('   ')).toBeNull();
    expect(normalizeFolder('a/./b')).toBeNull();
  });
});

describe('listTemplates', () => {
  const file = (path: string): FileEntry => ({ name: path.split('/').pop()!, path, is_dir: false });
  const dir = (path: string, children: FileEntry[]): FileEntry => ({
    name: path.split('/').pop()!,
    path,
    is_dir: true,
    children,
  });

  const tree: FileEntry[] = [
    dir('templates', [
      file('templates/Meeting.md'),
      file('templates/Daily.md'),
      file('templates/secret.md.age'),
      file('templates/logo.png'),
      dir('templates/work', [file('templates/work/Standup.md')]),
    ]),
    dir('templates-old', [file('templates-old/Stale.md')]),
    file('Note.md'),
  ];

  it('lists markdown files in the folder and below, sorted by path', () => {
    expect(listTemplates(tree, 'templates')).toEqual([
      { path: 'templates/Daily.md', name: 'Daily' },
      { path: 'templates/Meeting.md', name: 'Meeting' },
      { path: 'templates/work/Standup.md', name: 'Standup' },
    ]);
  });

  it('finds a nested templates folder', () => {
    const nested = [dir('meta', [dir('meta/tpl', [file('meta/tpl/A.md')])])];
    expect(listTemplates(nested, 'meta/tpl')).toEqual([{ path: 'meta/tpl/A.md', name: 'A' }]);
  });

  it('is empty when the folder does not exist', () => {
    expect(listTemplates(tree, 'nope')).toEqual([]);
  });
});
