//! Note indexer: turns `.md` files into chunk rows + embedding vectors.
//!
//! Single-note flow (`index_note`):
//!   1. Read file content (skip `.md.age` — encrypted notes are never
//!      indexed).
//!   2. Chunk with the sliding window.
//!   3. For every chunk, compute SHA-256 of the text. Compare against the
//!      rows already stored for this `note_path`:
//!        - same hash at the same `chunk_idx` → keep (no embedding cost)
//!        - new or changed → embed
//!        - removed (the file got shorter) → delete
//!   4. Send the changed chunks to the embedder in one batch (the
//!      embedder itself batches internally if it ever needs to). On
//!      success, write parents into `chunks` and vectors into
//!      `chunks_vec` inside a single transaction.
//!   5. Record token usage against the daily budget.
//!
//! Bulk reindex (`bulk_reindex`) walks the vault and calls `index_note`
//! per file, emitting `ai-index-progress` events the UI subscribes to.
//!
//! Concurrency: callers serialize on an external `IndexLock` (a tokio
//! Mutex held in `AiState`) so two reindexes can't run simultaneously
//! and a single-note reindex can't race a bulk pass.

use std::path::Path;

use anyhow::{Context, Result};
use serde::Serialize;
use sha2::{Digest, Sha256};
use walkdir::WalkDir;

use super::budget;
use super::chunker;
use super::embedder::{estimate_cost_usd, Embedder};
use super::store::{AiStore, EMBED_DIM};

#[derive(Debug, Clone, Serialize)]
pub struct IndexOutcome {
    pub note_path: String,
    /// Chunks present after this run (i.e. file is now represented by N
    /// vectors). 0 means the file was deleted or had no embeddable text.
    pub chunks_total: u32,
    /// Chunks we actually had to re-embed (cost something).
    pub chunks_embedded: u32,
    /// Chunks we kept by hash match (no embedding cost).
    pub chunks_kept: u32,
    /// Chunks removed because the file shrank or was deleted.
    pub chunks_removed: u32,
    pub tokens_in: u64,
    pub cost_usd: f64,
}

/// Remove every chunk + vector belonging to `note_path`. Used when a file
/// is deleted or renamed (rename = delete + index_note with new path).
pub fn remove_note(store: &AiStore, note_path: &str) -> Result<u32> {
    store.with_conn_mut(|c| {
        let tx = c.transaction()?;
        // Snapshot ids first so we can purge the matching vec0 rows. vec0
        // tables don't carry foreign keys, so we have to delete by rowid
        // explicitly.
        let ids: Vec<i64> = {
            let mut stmt = tx.prepare("SELECT id FROM chunks WHERE note_path = ?1")?;
            let collected: Vec<i64> = stmt
                .query_map([note_path], |r| r.get::<_, i64>(0))?
                .filter_map(|r| r.ok())
                .collect();
            collected
        };
        for id in &ids {
            tx.execute("DELETE FROM chunks_vec WHERE rowid = ?1", [id])?;
        }
        tx.execute("DELETE FROM chunks WHERE note_path = ?1", [note_path])?;
        tx.commit()?;
        Ok(ids.len() as u32)
    })
}

/// Index a single file. Returns counts so the caller (or the UI) can show
/// "X embedded, Y kept" without re-querying.
pub async fn index_note(
    store: &AiStore,
    embedder: &dyn Embedder,
    vault_root: &Path,
    rel_path: &str,
    daily_budget_usd: f64,
    model: &str,
) -> Result<IndexOutcome> {
    let abs = vault_root.join(rel_path);
    // Encrypted notes are intentionally invisible to AI. Same gate exists
    // in the bulk walker; defending in depth so a direct command call
    // can't bypass it either.
    if rel_path.ends_with(".md.age") || !rel_path.ends_with(".md") {
        return Ok(empty_outcome(rel_path));
    }
    let text = match std::fs::read_to_string(&abs) {
        Ok(t) => t,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {
            // File disappeared between enqueue and dequeue — treat as a
            // delete so stale chunks don't linger.
            let removed = remove_note(store, rel_path)?;
            return Ok(IndexOutcome {
                note_path: rel_path.to_string(),
                chunks_total: 0,
                chunks_embedded: 0,
                chunks_kept: 0,
                chunks_removed: removed,
                tokens_in: 0,
                cost_usd: 0.0,
            });
        }
        Err(e) => return Err(e).with_context(|| format!("read {}", abs.display())),
    };

    let chunks = chunker::chunk(&text);
    let new_hashes: Vec<String> = chunks.iter().map(hash_chunk).collect();

    // Load what we already have for this path: idx -> (id, hash).
    let existing = load_existing(store, rel_path)?;

    // Decide work per chunk: keep, replace, or fresh insert.
    let mut to_embed: Vec<(usize, String, String)> = Vec::new(); // (idx, text, hash)
    let mut kept = 0_u32;
    for (idx, (chunk_text, new_hash)) in chunks.iter().zip(new_hashes.iter()).enumerate() {
        match existing.get(&(idx as i64)) {
            Some((_id, old_hash)) if old_hash == new_hash => {
                kept += 1;
            }
            _ => {
                to_embed.push((idx, chunk_text.clone(), new_hash.clone()));
            }
        }
    }

    // Anything past the new file's chunk count is stale; drop those rows
    // (and their vectors) regardless of whether we touch the rest.
    let stale_indices: Vec<i64> = existing
        .keys()
        .copied()
        .filter(|i| (*i as usize) >= chunks.len())
        .collect();

    // Budget pre-check: refuse to start a batch that would push us over
    // the daily cap. Estimate uses the same 1-token-per-4-chars rule the
    // embedder falls back on, so the check stays consistent whether the
    // real API reports usage or not.
    let est_tokens: u64 = to_embed
        .iter()
        .map(|(_, t, _)| (t.chars().count() / 4) as u64)
        .sum();
    let est_cost = estimate_cost_usd(est_tokens);
    if !to_embed.is_empty() {
        budget::check(store, daily_budget_usd, model, est_cost)?;
    }

    let (vectors, tokens_in, cost_usd) = if to_embed.is_empty() {
        (Vec::new(), 0_u64, 0.0_f64)
    } else {
        let inputs: Vec<String> = to_embed.iter().map(|(_, t, _)| t.clone()).collect();
        let batch = embedder.embed(&inputs).await?;
        anyhow::ensure!(
            batch.vectors.len() == inputs.len(),
            "embedder returned {} vectors for {} inputs",
            batch.vectors.len(),
            inputs.len()
        );
        for v in &batch.vectors {
            anyhow::ensure!(
                v.len() == embedder.dim(),
                "embedder returned a {}-dim vector; expected {}",
                v.len(),
                embedder.dim()
            );
        }
        anyhow::ensure!(
            embedder.dim() == EMBED_DIM,
            "embedder dim {} does not match schema {}",
            embedder.dim(),
            EMBED_DIM
        );
        let tokens = batch.tokens_in;
        let cost = estimate_cost_usd(tokens);
        (batch.vectors, tokens, cost)
    };

    let now = chrono::Utc::now().timestamp();
    store.with_conn_mut(|c| {
        let tx = c.transaction()?;

        // 1. Delete stale rows (the file shrank).
        for idx in &stale_indices {
            if let Some((id, _)) = existing.get(idx) {
                tx.execute("DELETE FROM chunks_vec WHERE rowid = ?1", [id])?;
            }
            tx.execute(
                "DELETE FROM chunks WHERE note_path = ?1 AND chunk_idx = ?2",
                rusqlite::params![rel_path, idx],
            )?;
        }

        // 2. Upsert changed chunks. We delete-then-insert rather than try
        //    to update in place because vec0 rows are keyed by rowid and
        //    upserting a virtual table is awkward.
        for ((idx, text, hash), vec_row) in to_embed.iter().zip(vectors.iter()) {
            if let Some((id, _)) = existing.get(&(*idx as i64)) {
                tx.execute("DELETE FROM chunks_vec WHERE rowid = ?1", [id])?;
                tx.execute("DELETE FROM chunks WHERE id = ?1", [id])?;
            }
            tx.execute(
                "INSERT INTO chunks (note_path, chunk_idx, text, hash, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                rusqlite::params![rel_path, *idx as i64, text, hash, now],
            )?;
            let new_id = tx.last_insert_rowid();
            // vec0 accepts JSON arrays — slightly slower than raw bytes
            // but trivially correct and the JSON path is well-trodden.
            // MVP-2's perf budget doesn't care: encoding 1536 floats is
            // dwarfed by the network round-trip we just paid for.
            let json = encode_vec_json(vec_row);
            tx.execute(
                "INSERT INTO chunks_vec (rowid, embedding) VALUES (?1, ?2)",
                rusqlite::params![new_id, json],
            )?;
        }

        tx.commit()?;
        Ok(())
    })?;

    if tokens_in > 0 {
        budget::record(store, model, tokens_in, 0, cost_usd)?;
    }

    Ok(IndexOutcome {
        note_path: rel_path.to_string(),
        chunks_total: chunks.len() as u32,
        chunks_embedded: to_embed.len() as u32,
        chunks_kept: kept,
        chunks_removed: stale_indices.len() as u32,
        tokens_in,
        cost_usd,
    })
}

/// Walk the vault and re-index every `.md` file. `on_progress` fires once
/// per file so the caller can stream events to the UI. Returns aggregate
/// counts so the caller can render a final summary.
///
/// Failures are per-file: a single file that errors out doesn't abort the
/// whole pass; instead, the error is passed to `on_progress` and the walk
/// continues. Rationale: a fresh OpenRouter rate-limit during a 500-note
/// reindex shouldn't strand 400 already-cheaply-indexed notes.
pub async fn bulk_reindex<F>(
    store: &AiStore,
    embedder: &dyn Embedder,
    vault_root: &Path,
    daily_budget_usd: f64,
    model: &str,
    mut on_progress: F,
) -> Result<BulkSummary>
where
    F: FnMut(BulkProgress),
{
    let files = list_indexable_files(vault_root)?;
    let total = files.len() as u32;
    let mut done = 0_u32;
    let mut summary = BulkSummary::default();

    for rel in &files {
        let result = index_note(store, embedder, vault_root, rel, daily_budget_usd, model).await;
        done += 1;
        match result {
            Ok(outcome) => {
                summary.notes_ok += 1;
                summary.chunks_embedded += outcome.chunks_embedded;
                summary.chunks_kept += outcome.chunks_kept;
                summary.chunks_removed += outcome.chunks_removed;
                summary.tokens_in += outcome.tokens_in;
                summary.cost_usd += outcome.cost_usd;
                on_progress(BulkProgress {
                    done,
                    total,
                    note_path: rel.clone(),
                    error: None,
                });
            }
            Err(e) => {
                summary.notes_failed += 1;
                let msg = format!("{:#}", e);
                on_progress(BulkProgress {
                    done,
                    total,
                    note_path: rel.clone(),
                    error: Some(msg),
                });
                // Budget-exceeded is the one terminal error: continuing
                // would just rack up further failures.
                if e.downcast_ref::<budget::BudgetError>().is_some() {
                    return Ok(summary);
                }
            }
        }
    }

    // Reconcile the catalog: any note_path still in `chunks` that's not on
    // disk is a stale entry from a file that was deleted between
    // reindexes. Drop it here.
    let on_disk: std::collections::HashSet<String> = files.into_iter().collect();
    let in_db: Vec<String> = store.with_conn(|c| {
        let mut stmt = c.prepare("SELECT DISTINCT note_path FROM chunks")?;
        let paths: Vec<String> = stmt
            .query_map([], |r| r.get::<_, String>(0))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(paths)
    })?;
    for path in in_db {
        if !on_disk.contains(&path) {
            let removed = remove_note(store, &path)?;
            summary.chunks_removed += removed;
        }
    }

    Ok(summary)
}

#[derive(Debug, Clone, Serialize)]
pub struct BulkProgress {
    pub done: u32,
    pub total: u32,
    pub note_path: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct BulkSummary {
    pub notes_ok: u32,
    pub notes_failed: u32,
    pub chunks_embedded: u32,
    pub chunks_kept: u32,
    pub chunks_removed: u32,
    pub tokens_in: u64,
    pub cost_usd: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct IndexStatus {
    pub notes_indexed: u32,
    pub chunks_indexed: u32,
}

pub fn status(store: &AiStore) -> Result<IndexStatus> {
    store.with_conn(|c| {
        let chunks_indexed: i64 =
            c.query_row("SELECT COUNT(*) FROM chunks", [], |r| r.get(0))?;
        let notes_indexed: i64 = c.query_row(
            "SELECT COUNT(DISTINCT note_path) FROM chunks",
            [],
            |r| r.get(0),
        )?;
        Ok(IndexStatus {
            notes_indexed: notes_indexed.max(0) as u32,
            chunks_indexed: chunks_indexed.max(0) as u32,
        })
    })
}

// ---- internals ----------------------------------------------------------

fn empty_outcome(rel_path: &str) -> IndexOutcome {
    IndexOutcome {
        note_path: rel_path.to_string(),
        chunks_total: 0,
        chunks_embedded: 0,
        chunks_kept: 0,
        chunks_removed: 0,
        tokens_in: 0,
        cost_usd: 0.0,
    }
}

fn hash_chunk(text: &String) -> String {
    let mut hasher = Sha256::new();
    hasher.update(text.as_bytes());
    format!("{:x}", hasher.finalize())
}

type ExistingChunks = std::collections::HashMap<i64, (i64, String)>;

fn load_existing(store: &AiStore, rel_path: &str) -> Result<ExistingChunks> {
    store.with_conn(|c| {
        let mut stmt =
            c.prepare("SELECT chunk_idx, id, hash FROM chunks WHERE note_path = ?1")?;
        let rows = stmt
            .query_map([rel_path], |r| {
                Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, String>(2)?))
            })?
            .filter_map(|r| r.ok());
        let mut map: ExistingChunks = std::collections::HashMap::new();
        for (idx, id, hash) in rows {
            map.insert(idx, (id, hash));
        }
        Ok(map)
    })
}

fn encode_vec_json(v: &[f32]) -> String {
    let mut s = String::with_capacity(v.len() * 8 + 2);
    s.push('[');
    for (i, x) in v.iter().enumerate() {
        if i > 0 {
            s.push(',');
        }
        // Plain `{}` would lose precision on subnormals; `:.6` is enough
        // for cosine similarity and keeps row size sane (~10 KB per 1536-d
        // vector).
        s.push_str(&format!("{:.6}", x));
    }
    s.push(']');
    s
}

/// All `.md` files under the vault, relative to its root. Skips:
///   - `.md.age` (encrypted notes — never indexed)
///   - anything under `.mycel/` (our own metadata)
///   - hidden dirs (start with '.') — git, syncthing, etc.
fn list_indexable_files(vault_root: &Path) -> Result<Vec<String>> {
    let mut out = Vec::new();
    for entry in WalkDir::new(vault_root).into_iter().filter_entry(|e| {
        let name = e.file_name().to_string_lossy();
        !(name.starts_with('.') && e.depth() > 0)
    }) {
        let entry = entry.context("walking vault")?;
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        let name = match path.file_name().and_then(|s| s.to_str()) {
            Some(n) => n,
            None => continue,
        };
        if name.ends_with(".md.age") {
            continue;
        }
        if !name.ends_with(".md") {
            continue;
        }
        let rel = path
            .strip_prefix(vault_root)
            .context("strip vault prefix")?
            .to_string_lossy()
            .replace('\\', "/");
        out.push(rel);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::ai::embedder::testing::StubEmbedder;
    use tempfile::TempDir;

    fn make_vault() -> (TempDir, std::path::PathBuf) {
        let dir = TempDir::new().unwrap();
        let root = dir.path().to_path_buf();
        std::fs::create_dir_all(root.join(".mycel/ai")).unwrap();
        (dir, root)
    }

    fn write(root: &Path, rel: &str, content: &str) {
        let abs = root.join(rel);
        if let Some(parent) = abs.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(abs, content).unwrap();
    }

    #[tokio::test]
    async fn index_note_creates_chunks_and_vectors() {
        let (_d, root) = make_vault();
        write(&root, "a.md", "hello world");
        let store = AiStore::open(&root).unwrap();
        let embedder = StubEmbedder::new(EMBED_DIM);

        let outcome = index_note(&store, &embedder, &root, "a.md", 10.0, "test-model")
            .await
            .unwrap();
        assert_eq!(outcome.chunks_total, 1);
        assert_eq!(outcome.chunks_embedded, 1);
        assert_eq!(outcome.chunks_kept, 0);

        let s = status(&store).unwrap();
        assert_eq!(s.notes_indexed, 1);
        assert_eq!(s.chunks_indexed, 1);
    }

    #[tokio::test]
    async fn reindex_with_unchanged_file_skips_embeddings() {
        let (_d, root) = make_vault();
        write(&root, "a.md", "hello world");
        let store = AiStore::open(&root).unwrap();
        let embedder = StubEmbedder::new(EMBED_DIM);

        let _ = index_note(&store, &embedder, &root, "a.md", 10.0, "m").await.unwrap();
        let second = index_note(&store, &embedder, &root, "a.md", 10.0, "m").await.unwrap();
        assert_eq!(second.chunks_embedded, 0);
        assert_eq!(second.chunks_kept, 1);
        assert_eq!(second.tokens_in, 0);
    }

    #[tokio::test]
    async fn edit_triggers_only_changed_chunks() {
        let (_d, root) = make_vault();
        // Chunk 0 spans indices [0, WINDOW=1000). For an edit to leave
        // chunk 0's hash intact, the changed region has to live entirely
        // past index 1000.
        let head: String = "a".repeat(1000);
        let tail_v1: String = "b".repeat(500);
        let tail_v2: String = "c".repeat(500);
        write(&root, "a.md", &format!("{head}{tail_v1}"));
        let store = AiStore::open(&root).unwrap();
        let embedder = StubEmbedder::new(EMBED_DIM);

        let first = index_note(&store, &embedder, &root, "a.md", 10.0, "m").await.unwrap();
        assert!(first.chunks_total >= 2);

        write(&root, "a.md", &format!("{head}{tail_v2}"));
        let second = index_note(&store, &embedder, &root, "a.md", 10.0, "m").await.unwrap();
        assert!(second.chunks_kept >= 1, "first chunk should have been reused");
        assert!(second.chunks_embedded >= 1, "tail chunk should have been re-embedded");
    }

    #[tokio::test]
    async fn shrunk_file_drops_trailing_chunks() {
        let (_d, root) = make_vault();
        write(&root, "a.md", &"x".repeat(2500));
        let store = AiStore::open(&root).unwrap();
        let embedder = StubEmbedder::new(EMBED_DIM);

        let first = index_note(&store, &embedder, &root, "a.md", 10.0, "m").await.unwrap();
        assert!(first.chunks_total > 1);

        write(&root, "a.md", "tiny");
        let second = index_note(&store, &embedder, &root, "a.md", 10.0, "m").await.unwrap();
        assert_eq!(second.chunks_total, 1);
        assert!(second.chunks_removed >= 1);
        assert_eq!(status(&store).unwrap().chunks_indexed, 1);
    }

    #[tokio::test]
    async fn deleted_file_purges_all_chunks() {
        let (_d, root) = make_vault();
        write(&root, "a.md", "content");
        let store = AiStore::open(&root).unwrap();
        let embedder = StubEmbedder::new(EMBED_DIM);
        let _ = index_note(&store, &embedder, &root, "a.md", 10.0, "m").await.unwrap();

        std::fs::remove_file(root.join("a.md")).unwrap();
        let outcome = index_note(&store, &embedder, &root, "a.md", 10.0, "m").await.unwrap();
        assert_eq!(outcome.chunks_total, 0);
        assert_eq!(status(&store).unwrap().chunks_indexed, 0);
    }

    #[tokio::test]
    async fn encrypted_files_are_skipped() {
        let (_d, root) = make_vault();
        write(&root, "secret.md.age", "ENCRYPTED");
        let store = AiStore::open(&root).unwrap();
        let embedder = StubEmbedder::new(EMBED_DIM);

        let outcome = index_note(&store, &embedder, &root, "secret.md.age", 10.0, "m")
            .await
            .unwrap();
        assert_eq!(outcome.chunks_total, 0);
        assert_eq!(outcome.chunks_embedded, 0);
        assert_eq!(status(&store).unwrap().chunks_indexed, 0);
    }

    #[tokio::test]
    async fn bulk_reindex_walks_vault_and_skips_encrypted() {
        let (_d, root) = make_vault();
        write(&root, "a.md", "alpha");
        write(&root, "nested/b.md", "beta");
        write(&root, "c.md.age", "encrypted, must not be indexed");
        write(&root, ".mycel/internal.md", "should be skipped (dotdir)");

        let store = AiStore::open(&root).unwrap();
        let embedder = StubEmbedder::new(EMBED_DIM);

        let mut events: Vec<BulkProgress> = Vec::new();
        let summary = bulk_reindex(&store, &embedder, &root, 10.0, "m", |p| events.push(p))
            .await
            .unwrap();

        assert_eq!(summary.notes_ok, 2);
        assert_eq!(summary.notes_failed, 0);
        assert_eq!(events.len(), 2);
        assert_eq!(events.last().unwrap().total, 2);
        let s = status(&store).unwrap();
        assert_eq!(s.notes_indexed, 2);
    }

    #[tokio::test]
    async fn bulk_reindex_reconciles_deleted_files() {
        let (_d, root) = make_vault();
        write(&root, "a.md", "alpha");
        write(&root, "b.md", "beta");

        let store = AiStore::open(&root).unwrap();
        let embedder = StubEmbedder::new(EMBED_DIM);
        let _ = bulk_reindex(&store, &embedder, &root, 10.0, "m", |_| {}).await.unwrap();
        assert_eq!(status(&store).unwrap().notes_indexed, 2);

        std::fs::remove_file(root.join("a.md")).unwrap();
        let _ = bulk_reindex(&store, &embedder, &root, 10.0, "m", |_| {}).await.unwrap();
        assert_eq!(status(&store).unwrap().notes_indexed, 1);
    }

    #[tokio::test]
    async fn budget_exhaustion_halts_bulk_pass() {
        let (_d, root) = make_vault();
        // Several files, each long enough that even one would exceed
        // a near-zero budget.
        for i in 0..3 {
            write(&root, &format!("n{i}.md"), &"word ".repeat(500));
        }
        let store = AiStore::open(&root).unwrap();
        // Pre-record well over the budget — even a sub-penny per-chunk
        // estimate will then trip the check on the very first file.
        budget::record(&store, "m", 0, 0, 1.5).unwrap();
        let embedder = StubEmbedder::new(EMBED_DIM);

        let summary = bulk_reindex(&store, &embedder, &root, 1.0, "m", |_| {}).await.unwrap();
        assert!(summary.notes_failed >= 1);
        assert!(summary.notes_ok < 3);
    }
}
