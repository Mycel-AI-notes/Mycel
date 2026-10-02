import { describe, expect, it } from 'vitest';
import { displayName, isEncryptedPath, isNotePath } from './note-name';

describe('isNotePath', () => {
  it('accepts plaintext and encrypted notes', () => {
    expect(isNotePath('a/b.md')).toBe(true);
    expect(isNotePath('secret.md.age')).toBe(true);
  });

  it('rejects tabs, attachments and databases', () => {
    expect(isNotePath('pic.png')).toBe(false);
    expect(isNotePath('Knowledge Base/books.db.json')).toBe(false);
    expect(isNotePath('notes.mdx')).toBe(false);
    expect(isNotePath('')).toBe(false);
  });
});

describe('displayName / isEncryptedPath', () => {
  it('strip either suffix and spot encryption', () => {
    expect(displayName('x/Сад.md.age')).toBe('Сад');
    expect(isEncryptedPath('x/Сад.md.age')).toBe(true);
    expect(isEncryptedPath('x/Сад.md')).toBe(false);
  });
});
