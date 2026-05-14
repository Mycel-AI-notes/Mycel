//! SQLite-backed store for AI state.
//!
//! Location: `<vault>/.mycel/ai/index.db`. Created on first use; safe to
//! delete (Mycel will rebuild on demand).
//!
//! Schema:
//!   - `ai_usage`        daily-budget ledger (MVP-1)
//!   - `chunks`          one row per indexed text chunk (MVP-2)
//!   - `chunks_vec`      sqlite-vec virtual table, keyed by `chunks.id`
//!                       via rowid; carries the embedding vector
//!   - `semantic_edges`  reserved for MVP-2 graph rendering, written by
//!                       a follow-up PR but created up front so the
//!                       schema doesn't churn
//!
//! Migrations are linear and idempotent — every `CREATE TABLE IF NOT
//! EXISTS` runs every open, so a downgrade-then-upgrade cycle is a no-op.

use std::path::{Path, PathBuf};
use std::sync::{Mutex, Once};

use anyhow::{Context, Result};
use rusqlite::Connection;

/// Embedding dimensionality for `openai/text-embedding-3-small`. Hard-coded
/// because the vec0 virtual table needs a compile-time size, and switching
/// models means a schema change anyway (vec0 can't re-shape in place).
pub const EMBED_DIM: usize = 1536;

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
        ensure_vec_extension_registered();
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
        ensure_vec_extension_registered();
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

    /// Variant that hands a mutable Connection — required for transactions.
    pub fn with_conn_mut<F, R>(&self, f: F) -> Result<R>
    where
        F: FnOnce(&mut Connection) -> Result<R>,
    {
        let mut guard = self
            .conn
            .lock()
            .map_err(|_| anyhow::anyhow!("AiStore mutex poisoned"))?;
        f(&mut guard)
    }
}

fn db_path(vault_root: &Path) -> PathBuf {
    vault_root.join(".mycel").join("ai").join("index.db")
}

/// Hook `sqlite_vec_init` into `sqlite3_auto_extension` exactly once per
/// process. After this, every `Connection::open*` call inside this binary
/// automatically loads `vec0`, so we can `CREATE VIRTUAL TABLE … USING
/// vec0(...)` without per-connection bookkeeping.
fn ensure_vec_extension_registered() {
    static ONCE: Once = Once::new();
    ONCE.call_once(|| {
        // SAFETY: the `sqlite3_auto_extension` API is process-global and
        // documented to be called before any DB is opened in the process.
        // We guard it with `Once` so multi-vault sessions don't double-
        // register. The transmute coerces sqlite-vec's typed init entry
        // point to the opaque function-pointer shape the SQLite C API
        // expects — both are real function pointers, so the transmute is
        // size-compatible.
        use rusqlite::ffi;
        type AutoExtCb = unsafe extern "C" fn(
            *mut ffi::sqlite3,
            *mut *const std::ffi::c_char,
            *const ffi::sqlite3_api_routines,
        ) -> std::ffi::c_int;
        unsafe {
            let init: AutoExtCb =
                std::mem::transmute(sqlite_vec::sqlite3_vec_init as *const ());
            ffi::sqlite3_auto_extension(Some(init));
        }
    });
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

        CREATE TABLE IF NOT EXISTS chunks (
          id          INTEGER PRIMARY KEY,
          note_path   TEXT    NOT NULL,
          chunk_idx   INTEGER NOT NULL,
          text        TEXT    NOT NULL,
          hash        TEXT    NOT NULL,
          updated_at  INTEGER NOT NULL,
          UNIQUE(note_path, chunk_idx)
        );
        CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(note_path);

        CREATE TABLE IF NOT EXISTS semantic_edges (
          a_path TEXT NOT NULL,
          b_path TEXT NOT NULL,
          score  REAL NOT NULL,
          PRIMARY KEY(a_path, b_path)
        );
        "#,
    )?;

    // vec0 is a virtual table — its DDL takes the embedding dimension as a
    // literal, so we format it into the statement. `IF NOT EXISTS` works
    // with virtual tables in modern SQLite (>=3.21).
    conn.execute_batch(&format!(
        "CREATE VIRTUAL TABLE IF NOT EXISTS chunks_vec USING vec0(embedding float[{}]);",
        EMBED_DIM
    ))?;

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

    #[test]
    fn chunks_vec_table_exists_and_accepts_vectors() {
        let store = AiStore::open_in_memory().unwrap();
        store
            .with_conn(|c| {
                // Insert a parent chunk row, then a matching vec row.
                c.execute(
                    "INSERT INTO chunks (id, note_path, chunk_idx, text, hash, updated_at)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                    rusqlite::params![1_i64, "a.md", 0_i64, "hi", "h", 0_i64],
                )?;
                // sqlite-vec accepts vectors as JSON arrays or raw bytes.
                // JSON keeps the test readable; production code uses the
                // bytes path for performance.
                let dummy = format!("[{}]", "0.0,".repeat(EMBED_DIM - 1) + "0.0");
                c.execute(
                    "INSERT INTO chunks_vec (rowid, embedding) VALUES (?1, ?2)",
                    rusqlite::params![1_i64, dummy],
                )?;
                let count: i64 =
                    c.query_row("SELECT COUNT(*) FROM chunks_vec", [], |r| r.get(0))?;
                assert_eq!(count, 1);
                Ok(())
            })
            .unwrap();
    }
}
