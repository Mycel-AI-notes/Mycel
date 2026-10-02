//! Full-text search over note contents.
//!
//! Location: `<vault>/.mycel/search.db`, a SQLite file with an FTS5 index of
//! every plaintext `.md` note: title, body (frontmatter stripped) and tags.
//! Safe to delete — the next search rebuilds it.
//!
//! Deliberately separate from the AI index (`.mycel/ai/index.db`): that store
//! is only materialized once AI is enabled and carries the sqlite-vec schema,
//! while full-text search has to work in a vault that never touched AI and
//! has no API key. Keeping the two files apart also means wiping one never
//! costs the other a rebuild (re-embedding is paid for; this is free).
//!
//! Freshness:
//!
//! - `sync` walks the vault and reindexes only files whose mtime or size
//!   moved, then confirms with a content hash so a touched-but-unchanged
//!   file costs one read and no FTS write. It runs in the background on
//!   vault open and lazily before the first search of a session, and it
//!   prunes rows for notes that vanished while Mycel was closed.
//! - `update_path` handles one changed path. The file watcher calls it for
//!   every event, and the note commands call it right after they write, so a
//!   search issued immediately after a save never sees stale text.
//!
//! Encrypted `.md.age` notes are never indexed: the index lives in plaintext
//! next to the vault, and putting decrypted text there would undo the
//! encryption. Encrypting a note purges its old plaintext row (see
//! [`FtsIndex::purge`]).

pub mod query;
pub mod snippet;

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::time::UNIX_EPOCH;

use anyhow::{Context, Result};
use rusqlite::types::Value;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::core::links::note_stem;
use crate::core::parser::parse_note;
use crate::core::vault::walk_vault;
use query::{fold_yo, parse_query, Filter, ParsedQuery};
use snippet::{snippets_from_highlight, Snippet, HL_END, HL_START};

/// Bump when the schema or what gets indexed changes; an index built by an
/// older version is dropped and rebuilt instead of migrated — it is a cache.
const SCHEMA_VERSION: i64 = 1;

/// Default and ceiling for how many notes one search returns.
pub const DEFAULT_LIMIT: usize = 200;
const MAX_LIMIT: usize = 1000;

/// Snippets shown per note.
const SNIPPETS_PER_NOTE: usize = 3;

/// bm25 column weights: title, body, tags. A word in the title says far more
/// about what a note is *about* than one more mention in the body.
const BM25_WEIGHTS: &str = "10.0, 1.0, 5.0";

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct SearchHit {
    pub path: String,
    pub title: String,
    /// Title with hits wrapped in sentinel markers (same as snippets).
    pub title_highlight: String,
    pub snippets: Vec<Snippet>,
    /// 1-based line of the first body hit, for jump-to-line. `None` when only
    /// the title or tags matched, or for a filter-only query.
    pub line: Option<usize>,
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
pub struct SyncStats {
    pub indexed: usize,
    pub unchanged: usize,
    pub removed: usize,
}

pub struct FtsIndex {
    root: PathBuf,
    conn: Mutex<Connection>,
    /// Set once a full `sync` has completed in this session, so searches
    /// only pay for the walk the first time.
    synced: AtomicBool,
}

impl FtsIndex {
    pub fn open(vault_root: &Path) -> Result<Self> {
        let path = db_path(vault_root);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("Failed to create {}", parent.display()))?;
        }
        let conn = Connection::open(&path)
            .with_context(|| format!("Failed to open {}", path.display()))?;
        Self::with_connection(vault_root, conn)
    }

    #[cfg(test)]
    pub fn open_in_memory(vault_root: &Path) -> Result<Self> {
        Self::with_connection(vault_root, Connection::open_in_memory()?)
    }

    fn with_connection(vault_root: &Path, conn: Connection) -> Result<Self> {
        init_schema(&conn)?;
        Ok(Self {
            root: vault_root.to_path_buf(),
            conn: Mutex::new(conn),
            synced: AtomicBool::new(false),
        })
    }

    pub fn root(&self) -> &Path {
        &self.root
    }

    fn with_conn<R>(&self, f: impl FnOnce(&mut Connection) -> Result<R>) -> Result<R> {
        let mut guard = self
            .conn
            .lock()
            .map_err(|_| anyhow::anyhow!("FtsIndex mutex poisoned"))?;
        f(&mut guard)
    }

    /// Bring the index in line with the vault on disk.
    pub fn sync(&self) -> Result<SyncStats> {
        let on_disk = indexable_paths(&self.root);
        let stats = self.with_conn(|conn| {
            let tx = conn.transaction()?;
            let mut stats = SyncStats::default();

            let known: HashMap<String, (i64, i64)> = {
                let mut stmt = tx.prepare("SELECT path, mtime, size FROM docs")?;
                let rows =
                    stmt.query_map([], |r| Ok((r.get::<_, String>(0)?, (r.get(1)?, r.get(2)?))))?;
                rows.collect::<rusqlite::Result<_>>()?
            };

            let present: HashSet<&str> = on_disk.iter().map(String::as_str).collect();
            for path in known.keys() {
                if !present.contains(path.as_str()) {
                    delete_doc(&tx, path)?;
                    stats.removed += 1;
                }
            }

            for rel in &on_disk {
                let abs = self.root.join(rel);
                let Some(stamp) = file_stamp(&abs) else {
                    continue;
                };
                if known.get(rel) == Some(&stamp) {
                    stats.unchanged += 1;
                    continue;
                }
                if index_file(&tx, &abs, rel, stamp)? {
                    stats.indexed += 1;
                } else {
                    stats.unchanged += 1;
                }
            }

            tx.commit()?;
            Ok(stats)
        })?;
        self.synced.store(true, Ordering::SeqCst);
        Ok(stats)
    }

    /// `sync` unless one already ran this session.
    pub fn ensure_synced(&self) -> Result<()> {
        if !self.synced.load(Ordering::SeqCst) {
            self.sync()?;
        }
        Ok(())
    }

    /// Forget that this session already synced, so the next search walks the
    /// vault again. For bulk edits the caller cannot enumerate cheaply — a
    /// rename that rewrote wikilinks across the vault, say. The walk only
    /// re-reads files whose stamp moved.
    pub fn invalidate(&self) {
        self.synced.store(false, Ordering::SeqCst);
    }

    /// Drop everything and index the vault from scratch.
    pub fn rebuild(&self) -> Result<SyncStats> {
        self.with_conn(|conn| {
            conn.execute_batch("DELETE FROM docs; DELETE FROM docs_fts;")?;
            Ok(())
        })?;
        self.sync()
    }

    /// Reconcile one vault-relative path after something happened to it.
    ///
    /// The caller does not have to know *what* happened: a note that exists
    /// is (re)indexed, a directory that exists has its notes indexed (a
    /// folder moved in), and a path that is gone takes its row — and, for a
    /// folder, every row under it — out of the index. Renames are two calls,
    /// one per side.
    pub fn update_path(&self, rel: &str) -> Result<()> {
        let rel = rel.trim_matches('/');
        if rel.is_empty() || is_hidden_rel(rel) {
            return Ok(());
        }
        let abs = self.root.join(rel);
        self.with_conn(|conn| {
            let tx = conn.transaction()?;
            if abs.is_file() {
                if is_indexable(rel) {
                    if let Some(stamp) = file_stamp(&abs) {
                        index_file(&tx, &abs, rel, stamp)?;
                    }
                } else {
                    // Not a plaintext note (an image, a `.md.age`, a
                    // `.db.json`): nothing to index, and normally nothing to
                    // delete either — the call is a cheap no-op then.
                    delete_doc(&tx, rel)?;
                }
            } else if abs.is_dir() {
                // A folder moved in, or the watcher reported the folder
                // itself. Stamp-check each note so an event on a big,
                // untouched folder does not re-read every file in it.
                for sub in indexable_paths_under(&self.root, &abs) {
                    let sub_abs = self.root.join(&sub);
                    let Some(stamp) = file_stamp(&sub_abs) else {
                        continue;
                    };
                    let known: Option<(i64, i64)> = tx
                        .query_row(
                            "SELECT mtime, size FROM docs WHERE path = ?1",
                            params![sub],
                            |r| Ok((r.get(0)?, r.get(1)?)),
                        )
                        .optional()?;
                    if known != Some(stamp) {
                        index_file(&tx, &sub_abs, &sub, stamp)?;
                    }
                }
            } else {
                delete_doc(&tx, rel)?;
                tx.execute(
                    "DELETE FROM docs_fts WHERE rowid IN \
                     (SELECT id FROM docs WHERE path LIKE ?1 ESCAPE '\\')",
                    params![format!("{}/%", escape_like(rel))],
                )?;
                tx.execute(
                    "DELETE FROM docs WHERE path LIKE ?1 ESCAPE '\\'",
                    params![format!("{}/%", escape_like(rel))],
                )?;
            }
            tx.commit()?;
            Ok(())
        })
    }

    /// Remove `rel` and compact the index so its tokens are gone from disk,
    /// not just marked deleted. Used when a note is encrypted: FTS5 keeps a
    /// deleted document's terms in old b-tree segments until they merge, and
    /// `secure_delete` alone only scrubs the freed pages.
    pub fn purge(&self, rel: &str) -> Result<()> {
        self.update_path(rel)?;
        self.with_conn(|conn| {
            conn.execute("INSERT INTO docs_fts(docs_fts) VALUES('optimize')", [])?;
            Ok(())
        })
    }

    /// Number of indexed notes.
    pub fn len(&self) -> Result<usize> {
        self.with_conn(|conn| {
            let n: i64 = conn.query_row("SELECT count(*) FROM docs", [], |r| r.get(0))?;
            Ok(n as usize)
        })
    }

    /// Run a user query. Never fails on query *syntax* — `parse_query` is
    /// total and emits only quoted terms — so an error here is an I/O or
    /// database problem.
    pub fn search(&self, input: &str, limit: usize) -> Result<Vec<SearchHit>> {
        let q = parse_query(input);
        if q.is_empty() {
            return Ok(Vec::new());
        }
        let limit = limit.clamp(1, MAX_LIMIT);
        self.with_conn(|conn| run_query(conn, &q, limit))
    }
}

fn db_path(vault_root: &Path) -> PathBuf {
    vault_root.join(".mycel").join("search.db")
}

fn init_schema(conn: &Connection) -> Result<()> {
    // Rows of deleted notes are overwritten rather than left in free pages:
    // the index holds note plaintext, and a note the user just encrypted
    // should not linger in it.
    conn.execute_batch("PRAGMA secure_delete = ON;")?;

    let version: i64 = conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if version != SCHEMA_VERSION {
        conn.execute_batch("DROP TABLE IF EXISTS docs; DROP TABLE IF EXISTS docs_fts;")?;
    }

    // `docs` holds per-note bookkeeping keyed by the same rowid as the FTS
    // row. Path, file name and tags live here, lower-cased, because the
    // `path:` / `file:` / `tag:` filters want substring or exact-token
    // matching via LIKE, which a tokenized FTS column cannot give.
    //
    // `unicode61 remove_diacritics 2` folds case for Cyrillic and Latin alike
    // and makes `cafe` find `café`. The prefix index keeps `word*` queries —
    // which is every bare word — from scanning the whole term list.
    conn.execute_batch(&format!(
        r#"
        CREATE TABLE IF NOT EXISTS docs (
          id         INTEGER PRIMARY KEY,
          path       TEXT    NOT NULL UNIQUE,
          path_lc    TEXT    NOT NULL,
          name_lc    TEXT    NOT NULL,
          tags_lc    TEXT    NOT NULL,
          title      TEXT    NOT NULL,
          yo_title   TEXT    NOT NULL,
          yo_body    TEXT    NOT NULL,
          body_line  INTEGER NOT NULL,
          mtime      INTEGER NOT NULL,
          size       INTEGER NOT NULL,
          hash       TEXT    NOT NULL
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS docs_fts USING fts5(
          title, body, tags,
          tokenize = 'unicode61 remove_diacritics 2',
          prefix = '2 3'
        );
        PRAGMA user_version = {SCHEMA_VERSION};
        "#
    ))?;
    Ok(())
}

/// Plaintext notes only. `.md.age` is excluded by construction: its
/// extension is `age`.
fn is_indexable(rel: &str) -> bool {
    rel.ends_with(".md")
}

/// Any dot-segment (`.mycel/`, `.git/`, `.obsidian/`) — the same rule
/// `walk_vault` prunes by. The watcher reports events from inside them,
/// including our own writes to `.mycel/search.db`.
fn is_hidden_rel(rel: &str) -> bool {
    rel.split('/').any(|seg| seg.starts_with('.'))
}

fn indexable_paths(root: &Path) -> Vec<String> {
    indexable_paths_under(root, root)
}

fn indexable_paths_under(root: &Path, dir: &Path) -> Vec<String> {
    walk_vault(dir)
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| {
            let rel = e.path().strip_prefix(root).ok()?;
            let rel = rel.to_string_lossy().replace('\\', "/");
            (is_indexable(&rel) && !is_hidden_rel(&rel)).then_some(rel)
        })
        .collect()
}

/// `(mtime_ms, size)` — the cheap "did it change" check.
fn file_stamp(abs: &Path) -> Option<(i64, i64)> {
    let meta = std::fs::metadata(abs).ok()?;
    let mtime = meta
        .modified()
        .ok()
        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);
    Some((mtime, meta.len() as i64))
}

fn hash_hex(bytes: &[u8]) -> String {
    let digest = Sha256::digest(bytes);
    digest.iter().map(|b| format!("{b:02x}")).collect()
}

/// What goes into the index for one note.
#[derive(Debug, PartialEq)]
struct DocFields {
    title: String,
    body: String,
    /// Space-separated, lower-cased, de-duplicated.
    tags: Vec<String>,
    /// 0-based file line where `body` starts.
    body_line: usize,
}

fn extract_fields(rel: &str, raw: &str) -> DocFields {
    // Sentinels in the source would be indistinguishable from our highlight
    // markers.
    let raw: String = raw
        .chars()
        .filter(|&c| c != HL_START && c != HL_END)
        .collect();
    let parsed = parse_note(&raw);
    let title = parsed
        .meta
        .title
        .clone()
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| note_stem(rel).to_string());

    let mut tags: Vec<String> = Vec::new();
    for t in parsed.tags.iter().chain(parsed.meta.tags.iter()) {
        let t = t.trim().trim_start_matches('#').to_lowercase();
        if !t.is_empty() && !tags.contains(&t) {
            tags.push(t);
        }
    }

    let body_line = body_start_line(&raw, &parsed.body);
    DocFields {
        title,
        body: parsed.body,
        tags,
        body_line,
    }
}

/// Which line of `raw` the parsed `body` starts on. The frontmatter parser
/// hands back the body without saying where it came from and may trim
/// leading newlines, so locate the body's first real text in the raw file
/// and step back over the newlines it lost.
fn body_start_line(raw: &str, body: &str) -> usize {
    let lead = body.len() - body.trim_start_matches(['\n', '\r']).len();
    let lead_lines = body[..lead].matches('\n').count();
    let core = body.trim();
    if core.is_empty() {
        return 0;
    }
    // The body is the tail of the file, so its last occurrence is the real
    // one; a first-match search could land inside the frontmatter when the
    // body repeats the title.
    match raw.rfind(core) {
        Some(pos) => {
            let core_line = raw[..pos].matches('\n').count();
            // Leading whitespace on the body's first line is part of that
            // line, not extra lines.
            let ws_lines = body[lead..]
                .chars()
                .take_while(|c| c.is_whitespace())
                .filter(|&c| c == '\n')
                .count();
            core_line.saturating_sub(lead_lines + ws_lines)
        }
        None => 0,
    }
}

/// Fold `ё` for the index and remember where it was, as space-separated char
/// offsets. Stored next to the row so highlighted output — which FTS5 builds
/// from the folded text it holds — can be put back to what the note says.
fn fold_with_positions(s: &str) -> (String, String) {
    let mut positions = Vec::new();
    let folded: String = s
        .chars()
        .enumerate()
        .map(|(i, c)| match c {
            'ё' | 'Ё' => {
                positions.push(i.to_string());
                if c == 'ё' {
                    'е'
                } else {
                    'Е'
                }
            }
            other => other,
        })
        .collect();
    (folded, positions.join(" "))
}

/// Undo [`fold_with_positions`] on highlighted text: marker characters are
/// skipped when counting, everything else maps 1:1 to the folded original.
fn restore_yo(highlighted: &str, positions: &str) -> String {
    if positions.is_empty() {
        return highlighted.to_string();
    }
    let set: HashSet<usize> = positions
        .split(' ')
        .filter_map(|p| p.parse().ok())
        .collect();
    let mut i = 0usize;
    highlighted
        .chars()
        .map(|c| {
            if c == HL_START || c == HL_END {
                return c;
            }
            let out = if set.contains(&i) {
                match c {
                    'е' => 'ё',
                    'Е' => 'Ё',
                    other => other,
                }
            } else {
                c
            };
            i += 1;
            out
        })
        .collect()
}

/// (Re)index `rel` from disk. Returns whether the FTS content was rewritten
/// (`false` when the hash matched and only the stamp was refreshed).
fn index_file(conn: &Connection, abs: &Path, rel: &str, stamp: (i64, i64)) -> Result<bool> {
    let Ok(bytes) = std::fs::read(abs) else {
        // Vanished between the walk and the read.
        delete_doc(conn, rel)?;
        return Ok(false);
    };
    let hash = hash_hex(&bytes);

    let existing: Option<(i64, String)> = conn
        .query_row(
            "SELECT id, hash FROM docs WHERE path = ?1",
            params![rel],
            |r| Ok((r.get(0)?, r.get(1)?)),
        )
        .optional()?;
    if let Some((id, old_hash)) = &existing {
        if *old_hash == hash {
            conn.execute(
                "UPDATE docs SET mtime = ?1, size = ?2 WHERE id = ?3",
                params![stamp.0, stamp.1, id],
            )?;
            return Ok(false);
        }
    }

    let raw = String::from_utf8_lossy(&bytes);
    let fields = extract_fields(rel, &raw);
    let (title_fts, yo_title) = fold_with_positions(&fields.title);
    let (body_fts, yo_body) = fold_with_positions(&fields.body);
    let tags_text = fold_yo(&fields.tags.join(" "));
    // Padded so `tag:x` can match a whole tag with `% x %` and a nested
    // child with `% x/%`.
    let tags_lc = format!(" {tags_text} ");
    let name_lc = fold_yo(&note_stem(rel).to_lowercase());
    let path_lc = fold_yo(&rel.to_lowercase());

    // Replace rather than update in place: the row is cheap, and one code
    // path for "new" and "changed" is one less place for the two tables to
    // drift apart.
    if let Some((id, _)) = existing {
        conn.execute("DELETE FROM docs_fts WHERE rowid = ?1", params![id])?;
        conn.execute("DELETE FROM docs WHERE id = ?1", params![id])?;
    }
    conn.execute(
        "INSERT INTO docs(path, path_lc, name_lc, tags_lc, title, yo_title, yo_body, \
                          body_line, mtime, size, hash) \
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            rel,
            path_lc,
            name_lc,
            tags_lc,
            fields.title,
            yo_title,
            yo_body,
            fields.body_line as i64,
            stamp.0,
            stamp.1,
            hash
        ],
    )?;
    let id = conn.last_insert_rowid();
    conn.execute(
        "INSERT INTO docs_fts(rowid, title, body, tags) VALUES (?1, ?2, ?3, ?4)",
        params![id, title_fts, body_fts, tags_text],
    )?;
    Ok(true)
}

fn delete_doc(conn: &Connection, rel: &str) -> Result<()> {
    conn.execute(
        "DELETE FROM docs_fts WHERE rowid IN (SELECT id FROM docs WHERE path = ?1)",
        params![rel],
    )?;
    conn.execute("DELETE FROM docs WHERE path = ?1", params![rel])?;
    Ok(())
}

/// Escape `%`, `_` and the escape character itself for `LIKE … ESCAPE '\'`,
/// so `path:100%` or `file:my_note` mean what they say.
fn escape_like(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        if matches!(c, '\\' | '%' | '_') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// SQL `WHERE` fragments + bound values for the query's filters and
/// exclusions. Every user string is a bound parameter; only fixed SQL text
/// is formatted in.
fn filter_clauses(q: &ParsedQuery, params: &mut Vec<Value>) -> Vec<String> {
    let mut clauses = Vec::new();
    let mut like = |column: &str, f: &Filter, patterns: Vec<String>, params: &mut Vec<Value>| {
        let ors: Vec<String> = patterns
            .into_iter()
            .map(|p| {
                params.push(Value::Text(p));
                format!("d.{column} LIKE ?{} ESCAPE '\\'", params.len())
            })
            .collect();
        let any = format!("({})", ors.join(" OR "));
        clauses.push(if f.negated { format!("NOT {any}") } else { any });
    };

    for f in &q.paths {
        like(
            "path_lc",
            f,
            vec![format!("%{}%", escape_like(&f.value))],
            params,
        );
    }
    for f in &q.files {
        like(
            "name_lc",
            f,
            vec![format!("%{}%", escape_like(&f.value))],
            params,
        );
    }
    for f in &q.tags {
        let v = escape_like(&f.value);
        // The tag itself, or any nested child of it (`#area` finds
        // `#area/health`) — the same way the tag panel groups them.
        like(
            "tags_lc",
            f,
            vec![format!("% {v} %"), format!("% {v}/%")],
            params,
        );
    }

    if let Some(expr) = q.exclude_expr() {
        params.push(Value::Text(expr));
        clauses.push(format!(
            "d.id NOT IN (SELECT rowid FROM docs_fts WHERE docs_fts MATCH ?{})",
            params.len()
        ));
    }
    clauses
}

fn run_query(conn: &Connection, q: &ParsedQuery, limit: usize) -> Result<Vec<SearchHit>> {
    let mut params: Vec<Value> = Vec::new();

    let sql = if let Some(expr) = q.match_expr() {
        params.push(Value::Text(expr));
        let mut where_ = vec!["docs_fts MATCH ?1".to_string()];
        where_.extend(filter_clauses(q, &mut params));
        params.push(Value::Integer(limit as i64));
        format!(
            "SELECT d.path, d.title, d.body_line, d.yo_title, d.yo_body, \
                    highlight(docs_fts, 0, '{s}', '{e}'), \
                    highlight(docs_fts, 1, '{s}', '{e}') \
             FROM docs_fts JOIN docs d ON d.id = docs_fts.rowid \
             WHERE {w} \
             ORDER BY bm25(docs_fts, {BM25_WEIGHTS}) \
             LIMIT ?{n}",
            s = HL_START,
            e = HL_END,
            w = where_.join(" AND "),
            n = params.len(),
        )
    } else {
        // Filter-only query (`tag:ideas`): a listing, not a ranking.
        let where_ = filter_clauses(q, &mut params);
        params.push(Value::Integer(limit as i64));
        format!(
            "SELECT d.path, d.title, d.body_line, '', '', d.title, '' \
             FROM docs d WHERE {w} ORDER BY d.title COLLATE NOCASE LIMIT ?{n}",
            w = where_.join(" AND "),
            n = params.len(),
        )
    };

    let mut stmt = conn.prepare(&sql)?;
    let rows = stmt.query_map(rusqlite::params_from_iter(params), |r| {
        Ok((
            r.get::<_, String>(0)?,
            r.get::<_, String>(1)?,
            r.get::<_, i64>(2)?,
            r.get::<_, String>(3)?,
            r.get::<_, String>(4)?,
            r.get::<_, String>(5)?,
            r.get::<_, String>(6)?,
        ))
    })?;

    let mut hits = Vec::new();
    for row in rows {
        let (path, title, body_line, yo_title, yo_body, title_hl, body_hl) = row?;
        let title_hl = restore_yo(&title_hl, &yo_title);
        let body_hl = restore_yo(&body_hl, &yo_body);
        let snippets =
            snippets_from_highlight(&body_hl, body_line.max(0) as usize, SNIPPETS_PER_NOTE);
        hits.push(SearchHit {
            path,
            title,
            title_highlight: title_hl,
            line: snippets.first().map(|s| s.line),
            snippets,
        });
    }
    Ok(hits)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write(root: &Path, rel: &str, body: &str) {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, body).unwrap();
    }

    fn setup(files: &[(&str, &str)]) -> (TempDir, FtsIndex) {
        let dir = TempDir::new().unwrap();
        for (rel, body) in files {
            write(dir.path(), rel, body);
        }
        let idx = FtsIndex::open_in_memory(dir.path()).unwrap();
        idx.sync().unwrap();
        (dir, idx)
    }

    fn paths(idx: &FtsIndex, q: &str) -> Vec<String> {
        let mut p: Vec<String> = idx
            .search(q, DEFAULT_LIMIT)
            .unwrap()
            .into_iter()
            .map(|h| h.path)
            .collect();
        p.sort();
        p
    }

    fn plain(s: &str) -> String {
        s.replace(HL_START, "[").replace(HL_END, "]")
    }

    // ---- indexing ---------------------------------------------------------

    #[test]
    fn indexes_plain_notes_and_skips_hidden_and_encrypted() {
        let (_d, idx) = setup(&[
            ("a.md", "alpha"),
            ("sub/b.md", "alpha"),
            (".mycel/trash/x/c.md", "alpha"),
            (".git/d.md", "alpha"),
            ("secret.md.age", "alpha"),
            ("notes.txt", "alpha"),
        ]);
        assert_eq!(idx.len().unwrap(), 2);
        assert_eq!(paths(&idx, "alpha"), vec!["a.md", "sub/b.md"]);
    }

    #[test]
    fn frontmatter_is_not_searchable_but_title_and_tags_are() {
        let (_d, idx) = setup(&[(
            "n.md",
            "---\ntitle: Garden Plan\ntags: [veggies]\ncreated: zzzsecretdate\n---\n\nbody text\n",
        )]);
        assert!(paths(&idx, "zzzsecretdate").is_empty());
        assert_eq!(paths(&idx, "garden"), vec!["n.md"]);
        assert_eq!(paths(&idx, "veggies"), vec!["n.md"]);
        let hit = &idx.search("garden", 10).unwrap()[0];
        assert_eq!(hit.title, "Garden Plan");
        assert_eq!(plain(&hit.title_highlight), "[Garden] Plan");
    }

    #[test]
    fn title_falls_back_to_the_file_stem() {
        let (_d, idx) = setup(&[("folder/My Note.md", "x")]);
        let hit = &idx.search("my", 10).unwrap()[0];
        assert_eq!(hit.title, "My Note");
    }

    #[test]
    fn body_start_line_accounts_for_frontmatter() {
        let raw = "---\ntitle: T\ntags: [a]\n---\n\n# Heading\nline\n";
        let f = extract_fields("t.md", raw);
        let first = raw.lines().position(|l| l == "# Heading").unwrap();
        let in_body = f.body.lines().position(|l| l == "# Heading").unwrap();
        assert_eq!(f.body_line + in_body, first);
        assert_eq!(body_start_line("plain\ntext", "plain\ntext"), 0);
        assert_eq!(body_start_line("", ""), 0);
    }

    #[test]
    fn snippets_carry_file_line_numbers() {
        let (_d, idx) = setup(&[(
            "n.md",
            "---\ntitle: T\n---\n\nfirst line\nsecond has needle\nthird\nneedle again\n",
        )]);
        let hit = &idx.search("needle", 10).unwrap()[0];
        assert_eq!(hit.snippets.len(), 2);
        // Line 6 in the raw file, 1-based.
        assert_eq!(hit.line, Some(6));
        assert_eq!(hit.snippets[0].line, 6);
        assert_eq!(hit.snippets[1].line, 8);
        assert_eq!(plain(&hit.snippets[0].text), "second has [needle]");
    }

    // ---- incremental updates ---------------------------------------------

    #[test]
    fn resync_skips_unchanged_and_picks_up_changes() {
        let (d, idx) = setup(&[("a.md", "old words"), ("b.md", "stable")]);
        let stats = idx.sync().unwrap();
        assert_eq!(stats.indexed, 0);
        assert_eq!(stats.unchanged, 2);

        // Different size guarantees the stamp moves even on coarse mtimes.
        write(d.path(), "a.md", "brand new content");
        let stats = idx.sync().unwrap();
        assert_eq!(stats.indexed, 1);
        assert!(paths(&idx, "old").is_empty());
        assert_eq!(paths(&idx, "brand"), vec!["a.md"]);
    }

    #[test]
    fn touched_but_identical_files_are_hash_skipped() {
        let (d, idx) = setup(&[("a.md", "same")]);
        // Force a stamp mismatch without changing content.
        idx.with_conn(|c| {
            c.execute("UPDATE docs SET mtime = 0", [])?;
            Ok(())
        })
        .unwrap();
        let stats = idx.sync().unwrap();
        assert_eq!(stats.indexed, 0);
        assert_eq!(stats.unchanged, 1);
        let _ = d;
    }

    #[test]
    fn sync_prunes_deleted_notes() {
        let (d, idx) = setup(&[("a.md", "word"), ("b.md", "word")]);
        std::fs::remove_file(d.path().join("a.md")).unwrap();
        let stats = idx.sync().unwrap();
        assert_eq!(stats.removed, 1);
        assert_eq!(paths(&idx, "word"), vec!["b.md"]);
    }

    #[test]
    fn update_path_reindexes_a_saved_note() {
        let (d, idx) = setup(&[("a.md", "before")]);
        write(d.path(), "a.md", "after the edit");
        idx.update_path("a.md").unwrap();
        assert!(paths(&idx, "before").is_empty());
        assert_eq!(paths(&idx, "after"), vec!["a.md"]);
    }

    #[test]
    fn update_path_handles_a_rename() {
        let (d, idx) = setup(&[("old.md", "content")]);
        std::fs::rename(d.path().join("old.md"), d.path().join("new.md")).unwrap();
        idx.update_path("old.md").unwrap();
        idx.update_path("new.md").unwrap();
        assert_eq!(paths(&idx, "content"), vec!["new.md"]);
        assert_eq!(idx.len().unwrap(), 1);
    }

    #[test]
    fn update_path_handles_a_folder_move_and_delete() {
        let (d, idx) = setup(&[
            ("proj/a.md", "x1"),
            ("proj/deep/b.md", "x2"),
            ("project-other/c.md", "x3"),
        ]);
        std::fs::create_dir_all(d.path().join("archive")).unwrap();
        std::fs::rename(d.path().join("proj"), d.path().join("archive/proj")).unwrap();
        idx.update_path("proj").unwrap();
        idx.update_path("archive/proj").unwrap();
        assert_eq!(
            paths(&idx, "x1 OR x2 OR x3"),
            vec![
                "archive/proj/a.md",
                "archive/proj/deep/b.md",
                "project-other/c.md"
            ],
            "the sibling sharing a name prefix must survive"
        );

        std::fs::remove_dir_all(d.path().join("archive")).unwrap();
        idx.update_path("archive").unwrap();
        assert_eq!(paths(&idx, "x1 OR x2 OR x3"), vec!["project-other/c.md"]);
    }

    #[test]
    fn update_path_ignores_hidden_paths() {
        let (d, idx) = setup(&[]);
        write(d.path(), ".mycel/trash/t/a.md", "word");
        idx.update_path(".mycel/trash/t/a.md").unwrap();
        assert_eq!(idx.len().unwrap(), 0);
    }

    #[test]
    fn encrypting_a_note_removes_its_plaintext_row() {
        let (d, idx) = setup(&[("s.md", "classified words")]);
        std::fs::remove_file(d.path().join("s.md")).unwrap();
        write(d.path(), "s.md.age", "-----BEGIN AGE ENCRYPTED FILE-----");
        idx.purge("s.md").unwrap();
        idx.update_path("s.md.age").unwrap();
        assert!(paths(&idx, "classified").is_empty());
        assert_eq!(idx.len().unwrap(), 0);
    }

    #[test]
    fn rebuild_starts_over() {
        let (_d, idx) = setup(&[("a.md", "x"), ("b.md", "y")]);
        let stats = idx.rebuild().unwrap();
        assert_eq!(stats.indexed, 2);
        assert_eq!(idx.len().unwrap(), 2);
    }

    #[test]
    fn on_disk_index_reopens_and_survives_a_schema_bump() {
        let d = TempDir::new().unwrap();
        write(d.path(), "a.md", "persisted");
        {
            let idx = FtsIndex::open(d.path()).unwrap();
            idx.sync().unwrap();
        }
        let idx = FtsIndex::open(d.path()).unwrap();
        assert_eq!(idx.len().unwrap(), 1);
        drop(idx);

        // An index from another schema version is discarded, not trusted.
        let conn = Connection::open(db_path(d.path())).unwrap();
        conn.execute_batch("PRAGMA user_version = 999").unwrap();
        drop(conn);
        let idx = FtsIndex::open(d.path()).unwrap();
        assert_eq!(idx.len().unwrap(), 0);
        idx.ensure_synced().unwrap();
        assert_eq!(paths(&idx, "persisted"), vec!["a.md"]);
    }

    // ---- matching ---------------------------------------------------------

    #[test]
    fn cyrillic_is_case_folded() {
        let (_d, idx) = setup(&[("ru.md", "Сегодня изучал Программирование на Rust")]);
        assert_eq!(paths(&idx, "программирование"), vec!["ru.md"]);
        assert_eq!(paths(&idx, "СЕГОДНЯ rust"), vec!["ru.md"]);
    }

    #[test]
    fn yo_and_ye_are_interchangeable_and_display_keeps_yo() {
        let (_d, idx) = setup(&[("Ёлки.md", "Зелёная ёлка и ещё\n")]);
        assert_eq!(paths(&idx, "елка"), vec!["Ёлки.md"]);
        assert_eq!(paths(&idx, "ёлка еще"), vec!["Ёлки.md"]);
        assert_eq!(paths(&idx, "file:елки"), vec!["Ёлки.md"]);
        let hit = &idx.search("елка", 10).unwrap()[0];
        // The index stores folded text; what the user sees is restored.
        assert_eq!(plain(&hit.snippets[0].text), "Зелёная [ёлка] и ещё");
        let hit = &idx.search("елки", 10).unwrap()[0];
        assert_eq!(plain(&hit.title_highlight), "[Ёлки]");
    }

    #[test]
    fn yo_positions_round_trip() {
        let (folded, pos) = fold_with_positions("aЁb ё");
        assert_eq!(folded, "aЕb е");
        let hl = format!("a{HL_START}Еb{HL_END} е");
        assert_eq!(restore_yo(&hl, &pos), format!("a{HL_START}Ёb{HL_END} ё"));
        assert_eq!(restore_yo("plain", ""), "plain");
    }

    #[test]
    fn diacritics_are_folded() {
        let (_d, idx) = setup(&[("fr.md", "un café crème à Zürich")]);
        assert_eq!(paths(&idx, "cafe creme zurich"), vec!["fr.md"]);
    }

    #[test]
    fn bare_words_match_as_prefixes() {
        let (_d, idx) = setup(&[
            ("en.md", "programming languages"),
            ("ru.md", "программирование"),
        ]);
        assert_eq!(paths(&idx, "progr"), vec!["en.md"]);
        assert_eq!(paths(&idx, "прогр"), vec!["ru.md"]);
        assert_eq!(paths(&idx, "pr"), vec!["en.md"]);
    }

    #[test]
    fn phrases_need_adjacent_words_in_order() {
        let (_d, idx) = setup(&[
            ("a.md", "local first software"),
            ("b.md", "first, the local news"),
        ]);
        assert_eq!(paths(&idx, "\"local first\""), vec!["a.md"]);
        assert_eq!(paths(&idx, "local first"), vec!["a.md", "b.md"]);
    }

    #[test]
    fn exclusion_or_and_combinations() {
        let (_d, idx) = setup(&[
            ("a.md", "apple pie draft"),
            ("b.md", "apple tart"),
            ("c.md", "banana tart"),
        ]);
        assert_eq!(paths(&idx, "apple -draft"), vec!["b.md"]);
        assert_eq!(paths(&idx, "apple OR banana"), vec!["a.md", "b.md", "c.md"]);
        assert_eq!(paths(&idx, "apple OR banana tart"), vec!["b.md", "c.md"]);
        assert_eq!(paths(&idx, "tart -\"banana tart\""), vec!["b.md"]);
    }

    #[test]
    fn title_hits_outrank_body_hits() {
        let (_d, idx) = setup(&[
            ("body.md", "# Something else\n\nmentions compost once\n"),
            ("Compost.md", "# Notes\n\nabout soil\n"),
        ]);
        let hits = idx.search("compost", 10).unwrap();
        assert_eq!(hits[0].path, "Compost.md");
        assert_eq!(hits[0].line, None, "title-only hit has no body line");
        assert_eq!(hits[1].path, "body.md");
    }

    // ---- filters ----------------------------------------------------------

    #[test]
    fn path_filter_is_a_case_insensitive_substring() {
        let (_d, idx) = setup(&[
            ("Work/Projects/a.md", "plan"),
            ("Home/b.md", "plan"),
            ("Работа/c.md", "plan"),
        ]);
        assert_eq!(paths(&idx, "plan path:work"), vec!["Work/Projects/a.md"]);
        assert_eq!(
            paths(&idx, "plan path:projects/"),
            vec!["Work/Projects/a.md"]
        );
        assert_eq!(
            paths(&idx, "plan -path:work"),
            vec!["Home/b.md", "Работа/c.md"]
        );
        assert_eq!(paths(&idx, "plan path:работа"), vec!["Работа/c.md"]);
    }

    #[test]
    fn like_wildcards_in_filters_are_literal() {
        let (_d, idx) = setup(&[("a_b.md", "x"), ("axb.md", "x")]);
        assert_eq!(paths(&idx, "x file:a_b"), vec!["a_b.md"]);
        assert!(paths(&idx, "x path:%").is_empty());
    }

    #[test]
    fn file_filter_matches_the_name_not_the_folder() {
        let (_d, idx) = setup(&[("daily/2026-01-01.md", "log"), ("misc/daily.md", "log")]);
        assert_eq!(paths(&idx, "log file:daily"), vec!["misc/daily.md"]);
    }

    #[test]
    fn tag_filter_matches_body_and_frontmatter_tags() {
        let (_d, idx) = setup(&[
            ("a.md", "idea about #ml today"),
            ("b.md", "---\ntags: [ML, rust]\n---\n\nidea\n"),
            ("c.md", "idea with #mlops"),
            ("d.md", "idea in #ml/vision"),
            ("e.md", "idea mentioning ml"),
        ]);
        assert_eq!(
            paths(&idx, "idea tag:ml"),
            vec!["a.md", "b.md", "d.md"],
            "exact tag or nested child, not a prefix of another tag"
        );
        assert_eq!(paths(&idx, "tag:#rust"), vec!["b.md"]);
        assert_eq!(paths(&idx, "idea -tag:ml"), vec!["c.md", "e.md"]);
    }

    #[test]
    fn filter_only_queries_list_matching_notes() {
        let (_d, idx) = setup(&[("p/b.md", "x"), ("p/a.md", "y"), ("q/c.md", "z")]);
        let hits = idx.search("path:p/", 10).unwrap();
        let got: Vec<&str> = hits.iter().map(|h| h.path.as_str()).collect();
        assert_eq!(got, vec!["p/a.md", "p/b.md"], "sorted by title");
        assert!(hits
            .iter()
            .all(|h| h.snippets.is_empty() && h.line.is_none()));
        assert_eq!(paths(&idx, "path:p/ -y"), vec!["p/b.md"]);
    }

    #[test]
    fn limit_is_respected() {
        let files: Vec<(String, String)> = (0..30)
            .map(|i| (format!("n{i}.md"), "common".to_string()))
            .collect();
        let refs: Vec<(&str, &str)> = files
            .iter()
            .map(|(a, b)| (a.as_str(), b.as_str()))
            .collect();
        let (_d, idx) = setup(&refs);
        assert_eq!(idx.search("common", 5).unwrap().len(), 5);
        assert_eq!(idx.search("common", 0).unwrap().len(), 1, "clamped up to 1");
    }

    #[test]
    fn hostile_input_never_errors() {
        let (_d, idx) = setup(&[("a.md", "some text with \"quotes\" and c++ and NEAR words")]);
        for q in [
            "\"",
            "\"\"",
            "-",
            "--",
            "OR",
            "OR OR",
            "a OR",
            "*",
            "a*b",
            "^x",
            "NEAR(a b, 2)",
            "title:a",
            "body:x OR tags:y",
            "(",
            ")",
            "{title body}: x",
            "c++",
            "'; DROP TABLE docs; --",
            "path:'%",
            "tag:\"",
            "\u{E000}x\u{E001}",
            "AND",
            "NOT",
            "a NOT b",
        ] {
            assert!(idx.search(q, 10).is_ok(), "{q:?} errored");
        }
        assert_eq!(idx.len().unwrap(), 1, "nothing was dropped");
        assert_eq!(paths(&idx, "c++"), vec!["a.md"]);
        assert_eq!(paths(&idx, "NEAR"), vec!["a.md"]);
    }

    #[test]
    fn empty_query_returns_nothing() {
        let (_d, idx) = setup(&[("a.md", "x")]);
        assert!(idx.search("", 10).unwrap().is_empty());
        assert!(idx.search("-x", 10).unwrap().is_empty());
    }
}
