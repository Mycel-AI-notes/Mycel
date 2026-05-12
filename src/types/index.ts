export interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  children?: FileEntry[];
  is_knowledge_base?: boolean;
  is_quick_notes?: boolean;
  /** True if this directory has been promoted to a Knowledge Base via
   *  `kb_init`. Distinct from `is_knowledge_base` (single protected root
   *  folder). KB folders render with a 🗃 icon and clicking them opens
   *  `<dir>/index.md` instead of toggling the tree. */
  is_kb_dir?: boolean;
  /** True if this entry sits inside a promoted KB folder. KB-creation
   *  actions are hidden on descendants — a KB can only be created at
   *  its own root. */
  is_inside_kb?: boolean;
  /** True for `*.md.age` notes — file tree shows a lock icon and reads go
   *  through the decrypt path. */
  is_encrypted?: boolean;
}

export interface KbEntry {
  path: string;
  db: string;
  created_at: string;
}

export interface KbInitResult {
  index_path: string;
  db_path: string;
  rows_created: number;
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
  /** SHA-256 of the raw on-disk bytes at the moment we last loaded / saved
   *  this note. Passed back to `note_save_checked` so the backend can refuse
   *  to silently overwrite remote edits that landed between read and save. */
  disk_hash: string;
}

export type SaveCheckedResult =
  | { kind: 'saved'; disk_hash: string }
  | { kind: 'conflict'; disk_hash: string; disk_content: string; encrypted: boolean };

/** Stored on the vault store when a `note_save_checked` came back as
 *  `conflict`. The UI mounts a modal off this; resolving the conflict
 *  clears it. */
export interface SaveConflict {
  path: string;
  /** Content the user has in the editor — what they were trying to save. */
  localContent: string;
  /** Content currently on disk (post-pull, decrypted if applicable). */
  diskContent: string;
  /** Hash of the current disk bytes; used as the expected hash on the
   *  forced "keep mine" / "keep both" save so we don't bounce a second
   *  time if nothing else has changed. */
  diskHash: string;
}

export interface CryptoStatus {
  /** `recipients.txt` is non-empty — some device has set up crypto in
   *  this vault. May or may not be this device. */
  configured: boolean;
  /** This device has its own identity (wrapped file + matching KEK in
   *  the OS keyring). If false but `configured` is true, the vault was
   *  set up on another device and the user needs to Join. */
  local_identity_present: boolean;
  keyring_present: boolean;
  unlocked: boolean;
  recipients: number;
  primary_recipient: string | null;
  has_passphrase: boolean;
}

export interface ReencryptReport {
  rewrapped: number;
  skipped: number;
  failed_paths: string[];
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
