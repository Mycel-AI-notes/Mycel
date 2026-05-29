//! SQLite-backed metadata index for fast vault-wide queries.
//!
//! Location: `<vault>/.mycel/index.db`. Created on first use; safe to delete
//! (Mycel rebuilds it lazily on the next scan). Deliberately separate from the
//! AI index (`.mycel/ai/index.db`) so it works whether or not AI is configured.
//!
//! Step 1 caches each note's display title keyed by its vault-relative path and
//! invalidated by the file's modification time. `notes_list` consults the cache
//! and only reads + parses notes whose `mtime` changed since the last scan,
//! turning a full-vault read into a directory walk plus a handful of reads on
//! the steady-state path. The cache is self-healing: external edits (git pull,
//! another device) bump `mtime` and trigger a re-read, and entries for files
//! that vanished are pruned on the next scan.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use anyhow::{Context, Result};
use rusqlite::Connection;

pub struct NoteIndex {
    conn: Mutex<Connection>,
}

impl NoteIndex {
    pub fn open(vault_root: &Path) -> Result<Self> {
        let path = db_path(vault_root);
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)
                .with_context(|| format!("Failed to create {}", parent.display()))?;
        }
        let conn = Connection::open(&path)
            .with_context(|| format!("Failed to open {}", path.display()))?;
        init_schema(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Open an in-memory index for tests. Schema is identical.
    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        init_schema(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    /// Load every cached note title as `path -> (mtime, title)`. A poisoned
    /// lock or query error surfaces as `Err`; callers treat that as an empty
    /// cache and fall back to reading files.
    pub fn load_titles(&self) -> Result<HashMap<String, (i64, String)>> {
        let guard = self
            .conn
            .lock()
            .map_err(|_| anyhow::anyhow!("NoteIndex mutex poisoned"))?;
        let mut stmt = guard.prepare("SELECT path, mtime, title FROM note_titles")?;
        let rows = stmt.query_map([], |r| {
            Ok((
                r.get::<_, String>(0)?,
                (r.get::<_, i64>(1)?, r.get::<_, String>(2)?),
            ))
        })?;
        let mut map = HashMap::new();
        for row in rows {
            let (path, val) = row?;
            map.insert(path, val);
        }
        Ok(map)
    }

    /// Apply a batch of title upserts and path deletions in one transaction.
    /// `upserts` is `(path, mtime, title)`; `deletes` is the set of paths whose
    /// files no longer exist. A no-op when both are empty.
    pub fn apply_titles(&self, upserts: &[(String, i64, String)], deletes: &[String]) -> Result<()> {
        if upserts.is_empty() && deletes.is_empty() {
            return Ok(());
        }
        let mut guard = self
            .conn
            .lock()
            .map_err(|_| anyhow::anyhow!("NoteIndex mutex poisoned"))?;
        let tx = guard.transaction()?;
        {
            let mut up = tx.prepare(
                "INSERT INTO note_titles(path, mtime, title) VALUES(?1, ?2, ?3)
                 ON CONFLICT(path) DO UPDATE SET mtime = excluded.mtime, title = excluded.title",
            )?;
            for (path, mtime, title) in upserts {
                up.execute(rusqlite::params![path, mtime, title])?;
            }
            let mut del = tx.prepare("DELETE FROM note_titles WHERE path = ?1")?;
            for path in deletes {
                del.execute(rusqlite::params![path])?;
            }
        }
        tx.commit()?;
        Ok(())
    }
}

fn db_path(vault_root: &Path) -> PathBuf {
    vault_root.join(".mycel").join("index.db")
}

fn init_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS note_titles (
          path  TEXT    PRIMARY KEY,
          mtime INTEGER NOT NULL,
          title TEXT    NOT NULL
        );
        "#,
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn upsert_then_load_roundtrips() {
        let ix = NoteIndex::open_in_memory().unwrap();
        ix.apply_titles(
            &[
                ("a.md".into(), 100, "Alpha".into()),
                ("b.md".into(), 200, "Beta".into()),
            ],
            &[],
        )
        .unwrap();

        let map = ix.load_titles().unwrap();
        assert_eq!(map.get("a.md"), Some(&(100, "Alpha".to_string())));
        assert_eq!(map.get("b.md"), Some(&(200, "Beta".to_string())));
    }

    #[test]
    fn upsert_updates_existing_row() {
        let ix = NoteIndex::open_in_memory().unwrap();
        ix.apply_titles(&[("a.md".into(), 100, "Old".into())], &[]).unwrap();
        ix.apply_titles(&[("a.md".into(), 150, "New".into())], &[]).unwrap();

        let map = ix.load_titles().unwrap();
        assert_eq!(map.get("a.md"), Some(&(150, "New".to_string())));
        assert_eq!(map.len(), 1);
    }

    #[test]
    fn delete_prunes_row() {
        let ix = NoteIndex::open_in_memory().unwrap();
        ix.apply_titles(
            &[("a.md".into(), 1, "A".into()), ("b.md".into(), 1, "B".into())],
            &[],
        )
        .unwrap();
        ix.apply_titles(&[], &["a.md".into()]).unwrap();

        let map = ix.load_titles().unwrap();
        assert!(!map.contains_key("a.md"));
        assert!(map.contains_key("b.md"));
    }

    #[test]
    fn empty_batch_is_noop() {
        let ix = NoteIndex::open_in_memory().unwrap();
        ix.apply_titles(&[], &[]).unwrap();
        assert!(ix.load_titles().unwrap().is_empty());
    }
}
