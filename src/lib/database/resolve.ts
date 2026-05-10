// Resolve a `source:` path from a code fence to a vault-relative path.
// `source` may be relative to the current note's directory, or vault-relative.
export function resolveDbPath(currentNotePath: string, source: string): string {
  source = source.trim();
  if (!source) return source;

  // Vault-absolute (starts with /) — strip leading slash
  if (source.startsWith('/')) return source.replace(/^\/+/, '');

  // Relative — join with the directory of the current note
  const noteDir = currentNotePath.includes('/')
    ? currentNotePath.replace(/\/[^/]*$/, '')
    : '';

  if (!noteDir) return source;

  // Resolve `..` and `.` segments
  const parts = (noteDir + '/' + source).split('/');
  const stack: string[] = [];
  for (const part of parts) {
    if (part === '' || part === '.') continue;
    if (part === '..') {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.join('/');
}

export interface DbBlockSpec {
  source: string;
  view?: string;
}

export function parseDbBlock(content: string): DbBlockSpec {
  const spec: DbBlockSpec = { source: '' };
  for (const rawLine of content.split('\n')) {
    const line = rawLine.trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === 'source') spec.source = value;
    else if (key === 'view') spec.view = value;
  }
  return spec;
}
