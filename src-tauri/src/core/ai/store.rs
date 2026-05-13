//! SQLite-backed store for AI state.
//!
//! Location: `<vault>/.mycel/ai/index.db`. Created on first use; safe to
//! delete (Mycel will rebuild on demand).
//!
//! MVP-1 schema: just `ai_usage` for the daily-budget tracker.
//! MVP-2 will add `chunks`, `chunks_vec` (sqlite-vec virtual table), and
//! `semantic_edges` tables. Migrations are linear and idempotent — each
//! `CREATE TABLE IF NOT EXISTS` runs every open, so re-running them after
//! a downgrade-then-upgrade cycle is a no-op.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use anyhow::{Context, Result};
use rusqlite::Connection;

pub struct AiStore {
    conn: Mutex<Connection>,
}

impl AiStore {
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

    /// Open an in-memory store for tests. Schema is identical.
    #[cfg(test)]
    pub fn open_in_memory() -> Result<Self> {
        let conn = Connection::open_in_memory()?;
        init_schema(&conn)?;
        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn with_conn<F, R>(&self, f: F) -> Result<R>
    where
        F: FnOnce(&Connection) -> Result<R>,
    {
        let guard = self
            .conn
            .lock()
            .map_err(|_| anyhow::anyhow!("AiStore mutex poisoned"))?;
        f(&guard)
    }
}

fn db_path(vault_root: &Path) -> PathBuf {
    vault_root.join(".mycel").join("ai").join("index.db")
}

fn init_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS ai_usage (
          date       TEXT    NOT NULL,
          model      TEXT    NOT NULL,
          tokens_in  INTEGER NOT NULL DEFAULT 0,
          tokens_out INTEGER NOT NULL DEFAULT 0,
          cost_usd   REAL    NOT NULL DEFAULT 0,
          PRIMARY KEY(date, model)
        );
        "#,
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn opens_in_memory() {
        let store = AiStore::open_in_memory().unwrap();
        store
            .with_conn(|c| {
                let count: i64 =
                    c.query_row("SELECT COUNT(*) FROM ai_usage", [], |r| r.get(0))?;
                assert_eq!(count, 0);
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn open_creates_directory() {
        let dir = tempfile::TempDir::new().unwrap();
        let _store = AiStore::open(dir.path()).unwrap();
        assert!(dir.path().join(".mycel").join("ai").join("index.db").exists());
    }

    #[test]
    fn re_open_is_idempotent() {
        let dir = tempfile::TempDir::new().unwrap();
        let _ = AiStore::open(dir.path()).unwrap();
        let _ = AiStore::open(dir.path()).unwrap();
    }
}
