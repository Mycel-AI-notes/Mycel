import { Document, isMap, isScalar, isSeq, parseDocument, YAMLMap } from 'yaml';

/**
 * Page header data — the icon and the properties of a note — lives in its
 * YAML frontmatter, so it stays plain Markdown that Obsidian, static-site
 * generators and `grep` all understand:
 *
 * ```yaml
 * ---
 * icon: sprout
 * icon_color: teal
 * status: In progress
 * area: [AI/ML, CV]
 * ---
 * ```
 *
 * Everything here works on the raw document text; the editor turns the
 * returned changes into CodeMirror transactions so they land in undo history
 * and go through autosave like any keystroke.
 */

/** Keys the header owns and never lists as properties. */
export const ICON_KEY = 'icon';
export const ICON_COLOR_KEY = 'icon_color';
const HIDDEN_KEYS = new Set([ICON_KEY, ICON_COLOR_KEY]);

export type PropType =
  | 'text'
  | 'number'
  | 'checkbox'
  | 'date'
  | 'select'
  | 'multi-select'
  | 'url';

export const PROP_TYPES: PropType[] = [
  'text',
  'select',
  'multi-select',
  'date',
  'number',
  'checkbox',
  'url',
];

export const PROP_TYPE_LABEL: Record<PropType, string> = {
  text: 'Text',
  number: 'Number',
  checkbox: 'Checkbox',
  date: 'Date',
  select: 'Select',
  'multi-select': 'Multi-select',
  url: 'URL',
};

export type PropValue = string | number | boolean | string[] | null;

export interface PageProperty {
  key: string;
  value: PropValue;
}

export interface PageMeta {
  icon: string | null;
  iconColor: string | null;
  properties: PageProperty[];
  /** The YAML did not parse. The header then offers only the raw source,
   *  so a typo is never "fixed" by rewriting the user's frontmatter. */
  invalid: boolean;
}

export interface FrontmatterRange {
  /** Always 0 — frontmatter only counts at the very start of the file. */
  from: number;
  /** End of the closing `---` line (before its newline). */
  to: number;
  /** The YAML between the fences, without them. */
  yaml: string;
}

const FENCE = /^---\s*$/;

/** Locate a leading `---` … `---` block. Mirrors the Rust parser: the opening
 *  fence must be the first line, and an unterminated block is not
 *  frontmatter. */
export function findFrontmatter(doc: string): FrontmatterRange | null {
  const firstNl = doc.indexOf('\n');
  const first = firstNl === -1 ? doc : doc.slice(0, firstNl);
  if (!FENCE.test(first.replace(/\r$/, '')) || firstNl === -1) return null;
  let pos = firstNl + 1;
  while (pos <= doc.length) {
    const nl = doc.indexOf('\n', pos);
    const end = nl === -1 ? doc.length : nl;
    const line = doc.slice(pos, end).replace(/\r$/, '');
    if (FENCE.test(line)) {
      return { from: 0, to: end, yaml: doc.slice(firstNl + 1, pos) };
    }
    if (nl === -1) break;
    pos = nl + 1;
  }
  return null;
}

function toPropValue(v: unknown): PropValue {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) {
    return v
      .filter((x) => x !== null && x !== undefined && typeof x !== 'object')
      .map((x) => String(x));
  }
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  // Nested maps have no sensible single-cell editor; show them as text so
  // they stay visible, and only rewrite them if the user edits that cell.
  return JSON.stringify(v);
}

export function readPageMeta(yaml: string | null): PageMeta {
  const empty: PageMeta = { icon: null, iconColor: null, properties: [], invalid: false };
  if (yaml === null || yaml.trim() === '') return empty;
  const doc = parseDocument(yaml);
  if (doc.errors.length > 0) return { ...empty, invalid: true };
  if (doc.contents === null) return empty;
  if (!isMap(doc.contents)) return { ...empty, invalid: true };

  const out: PageMeta = { ...empty, properties: [] };
  for (const pair of doc.contents.items) {
    const key = isScalar(pair.key) ? String(pair.key.value) : String(pair.key);
    const raw = pair.value && typeof pair.value === 'object' && 'toJSON' in pair.value
      ? (pair.value as { toJSON(): unknown }).toJSON()
      : pair.value;
    if (key === ICON_KEY) {
      out.icon = raw === null || raw === undefined ? null : String(raw).trim() || null;
    } else if (key === ICON_COLOR_KEY) {
      out.iconColor = raw === null || raw === undefined ? null : String(raw).trim() || null;
    } else if (!HIDDEN_KEYS.has(key)) {
      out.properties.push({ key, value: toPropValue(raw) });
    }
  }
  return out;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2})?)?/;
const URL_RE = /^https?:\/\/\S+$/i;

/** Keys that read as a single choice even before the user says so —
 *  `status: Draft` is almost never free text. */
const SELECT_BY_DEFAULT = new Set(['status', 'priority', 'type', 'stage', 'kind']);

/** The type a value looks like when nothing has been chosen for its key. */
export function inferType(key: string, value: PropValue): PropType {
  if (Array.isArray(value)) return 'multi-select';
  if (typeof value === 'boolean') return 'checkbox';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'string') {
    if (DATE_RE.test(value)) return 'date';
    if (URL_RE.test(value)) return 'url';
  }
  if (SELECT_BY_DEFAULT.has(key.toLowerCase())) return 'select';
  return 'text';
}

/** Reshape `value` to fit `type`, keeping as much of it as makes sense. */
export function coerceValue(value: PropValue, type: PropType): PropValue {
  const asText = Array.isArray(value)
    ? value.join(', ')
    : value === null
      ? ''
      : String(value);
  switch (type) {
    case 'multi-select':
      if (Array.isArray(value)) return value;
      return asText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    case 'checkbox':
      if (typeof value === 'boolean') return value;
      return /^(true|yes|1|x|done)$/i.test(asText.trim());
    case 'number': {
      if (typeof value === 'number') return value;
      const n = Number(asText.trim());
      return asText.trim() !== '' && Number.isFinite(n) ? n : null;
    }
    case 'date':
      return DATE_RE.test(asText) ? asText : null;
    case 'select':
      return Array.isArray(value) ? (value[0] ?? null) : asText || null;
    case 'text':
    case 'url':
      return asText || null;
  }
}

/** What a freshly added property of `type` starts as. */
export function emptyValue(type: PropType): PropValue {
  if (type === 'multi-select') return [];
  if (type === 'checkbox') return false;
  return null;
}

export type FrontmatterMutation = (doc: Document) => void;

export interface TextChange {
  from: number;
  to: number;
  insert: string;
}

/**
 * Apply `mutate` to the note's frontmatter and return the text change that
 * gets there — creating the block when the note has none, and dropping it
 * again when the last key goes. Returns null when the YAML does not parse
 * (we never rewrite what we could not read) or nothing changed.
 */
export function frontmatterChange(docText: string, mutate: FrontmatterMutation): TextChange | null {
  const fm = findFrontmatter(docText);
  const doc = parseDocument(fm?.yaml ?? '');
  if (doc.errors.length > 0) return null;
  if (doc.contents === null) doc.contents = doc.createNode({}) as unknown as typeof doc.contents;
  if (!isMap(doc.contents)) return null;

  mutate(doc);

  const map = doc.contents as unknown as YAMLMap;
  if (map.items.length === 0) {
    if (!fm) return null;
    const after = docText.charAt(fm.to) === '\n' ? fm.to + 1 : fm.to;
    return { from: 0, to: after, insert: '' };
  }

  const yaml = doc.toString({ lineWidth: 0, nullStr: '', flowCollectionPadding: false });
  const block = `---\n${yaml}${yaml.endsWith('\n') ? '' : '\n'}---`;
  if (fm) {
    if (docText.slice(0, fm.to) === block) return null;
    return { from: 0, to: fm.to, insert: block };
  }
  return { from: 0, to: 0, insert: `${block}\n` };
}

/** Lists go in as flow sequences — `tags: [a, b]` reads like the chips. */
function valueNode(doc: Document, value: PropValue) {
  const node = doc.createNode(value);
  if (isSeq(node)) node.flow = true;
  return node;
}

export const setProp =
  (key: string, value: PropValue): FrontmatterMutation =>
  (doc) => {
    doc.set(key, valueNode(doc, value));
  };

export const deleteProp =
  (key: string): FrontmatterMutation =>
  (doc) => {
    doc.delete(key);
  };

/** Rename in place so the property keeps its position in the list. */
export const renameProp =
  (from: string, to: string): FrontmatterMutation =>
  (doc) => {
    if (from === to || doc.has(to)) return;
    const map = doc.contents as unknown as YAMLMap;
    const pair = map.items.find(
      (p) => (isScalar(p.key) ? String(p.key.value) : String(p.key)) === from,
    );
    if (pair) pair.key = doc.createNode(to);
  };

/** Set or clear the page icon (and its tint). Icon keys go first so they
 *  read as the page's identity, not as one more property. */
export const setIcon =
  (icon: string | null, color: string | null): FrontmatterMutation =>
  (doc) => {
    doc.delete(ICON_KEY);
    doc.delete(ICON_COLOR_KEY);
    if (!icon) return;
    const map = doc.contents as unknown as YAMLMap;
    const pairs = [doc.createPair(ICON_KEY, icon)];
    if (color) pairs.push(doc.createPair(ICON_COLOR_KEY, color));
    map.items.unshift(...pairs);
  };

/** Cheap icon lookup for places that only need the glyph (tabs) — a line
 *  scan instead of a YAML parse on every render. */
export function pageIconOf(content: string): { icon: string; color: string | null } | null {
  const fm = findFrontmatter(content);
  if (!fm) return null;
  const icon = fm.yaml.match(/^icon:[ \t]*['"]?([^'"\n]+?)['"]?[ \t]*$/m)?.[1];
  if (!icon) return null;
  const color = fm.yaml.match(/^icon_color:[ \t]*['"]?([^'"\n]+?)['"]?[ \t]*$/m)?.[1] ?? null;
  return { icon, color };
}
