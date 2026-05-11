export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileEntry[];
  is_knowledge_base?: boolean;
  is_quick_notes?: boolean;
  /** True for `*.md.age` notes — file tree shows a lock icon and reads go
   *  through the decrypt path. */
  is_encrypted?: boolean;
}

export const KNOWLEDGE_BASE_DIR = 'Knowledge Base';
export const QUICK_NOTES_DIR = 'quick';

export interface NoteMeta {
  title?: string;
  tags?: string[];
  created?: string;
  modified?: string;
}

export interface Heading {
  level: number;
  text: string;
  /** 0-based line number in the note body (without frontmatter). Populated by
   *  the TS reparser; absent for headings that came straight from the Rust
   *  parser. */
  line?: number;
}

export interface WikiLink {
  target: string;
  alias?: string;
  is_embed: boolean;
}

export interface ParsedNote {
  meta: NoteMeta;
  body: string;
  headings: Heading[];
  wikilinks: WikiLink[];
  tags: string[];
}

export interface Note {
  path: string;
  content: string;
  parsed: ParsedNote;
  /** Backend signals that the on-disk file was `.md.age` and we decrypted
   *  it. The save round-trip re-encrypts transparently. */
  encrypted?: boolean;
}

export interface CryptoStatus {
  configured: boolean;
  keyring_present: boolean;
  unlocked: boolean;
  recipients: number;
  primary_recipient: string | null;
}

export interface Tab {
  path: string;
  title: string;
  isDirty: boolean;
  /// Preview tabs are transient: opening another preview tab replaces them
  /// instead of appending. Saving the file promotes a preview tab to a
  /// regular pinned tab. Double-clicking the tab also pins it.
  isPreview?: boolean;
}

export interface SyncConfig {
  remote: string;
  branch: string;
  author_name: string;
  author_email: string;
  auto_sync: boolean;
  debounce_ms: number;
  last_sync_at?: string | null;
}

export interface SyncStatus {
  configured: boolean;
  has_token: boolean;
  remote: string | null;
  branch: string | null;
  ahead: number;
  behind: number;
  dirty: boolean;
  conflicts: string[];
  last_sync_at: string | null;
}

export type SyncOutcome =
  | { kind: 'up_to_date' }
  | { kind: 'pulled'; commits: number }
  | { kind: 'pushed'; commits: number }
  | { kind: 'pulled_and_pushed'; pulled: number; pushed: number }
  | { kind: 'conflict'; files: string[] };
