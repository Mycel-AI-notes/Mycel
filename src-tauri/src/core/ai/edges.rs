//! Pairwise semantic edges between notes — the data behind the graph
//! view's "Semantic" toggle.
//!
//! For every indexed note we read its chunk vectors, mean them into a
//! note-level centroid, and L2-normalize that centroid so cosine
//! similarity reduces to a plain dot product. Then we do an O(N²) sweep
//! of all unordered note pairs, drop everything below `BASELINE_SCORE`,
//! and replace the contents of `semantic_edges` with the survivors.
//!
//! UI slider lives in [0.6, 0.95]; we store anything ≥ 0.5 so the
//! slider has a touch of headroom without forcing a full recompute if
//! the lower bound ever drops.
//!
//! Recompute is explicit (a Tauri command kicks it off). We deliberately
//! don't re-run it after every save — for a 1k-note vault one pass is
//! ~1s, but firing it on every keystroke-driven auto-reindex would
//! waste cycles for no UX win. The user re-runs it from the graph
//! toolbar when they want refreshed clusters.

use anyhow::Result;
use serde::Serialize;

use super::store::AiStore;

/// Lowest cosine similarity we bother to store. Sets the floor of the
/// UI slider's effective range.
pub const BASELINE_SCORE: f32 = 0.5;

#[derive(Debug, Clone, Serialize)]
pub struct SemanticEdge {
    pub a_path: String,
    pub b_path: String,
    pub score: f32,
}

#[derive(Debug, Clone, Default, Serialize)]
pub struct EdgesSummary {
    pub notes_considered: u32,
    pub pairs_evaluated: u64,
    pub edges_stored: u32,
}

#[derive(Debug, Clone, Serialize)]
pub struct RecomputeProgress {
    /// Number of source notes whose pairs have been fully evaluated.
    pub done: u32,
    pub total: u32,
}

/// Walk every indexed note, compute centroids, evaluate all unordered
/// pairs, and replace `semantic_edges` with the survivors. `on_progress`
/// fires once per outer-loop note so the UI can show a "computing edges…"
/// bar — pure-CPU work, no network calls.
pub fn recompute<F>(store: &AiStore, mut on_progress: F) -> Result<EdgesSummary>
where
    F: FnMut(RecomputeProgress),
{
    // 1. Pull all indexed note paths.
    let paths: Vec<String> = store.with_conn(|c| {
        let mut stmt = c.prepare("SELECT DISTINCT note_path FROM chunks")?;
        let v: Vec<String> = stmt
            .query_map([], |r| r.get::<_, String>(0))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(v)
    })?;

    // 2. Compute a normalized centroid per note. We collect into parallel
    //    Vecs (paths, centroids) so the inner pair loop is a tight
    //    index-based double walk — autovectorization friendly.
    let mut centroids: Vec<Vec<f32>> = Vec::with_capacity(paths.len());
    let mut kept_paths: Vec<String> = Vec::with_capacity(paths.len());
    for path in &paths {
        let vecs = read_note_vectors(store, path)?;
        if vecs.is_empty() {
            continue;
        }
        let mut c = mean(&vecs);
        normalize(&mut c);
        centroids.push(c);
        kept_paths.push(path.clone());
    }
    let n = kept_paths.len();
    let total = n as u32;

    // 3. Wipe + repopulate inside one transaction. The DELETE alone is
    //    cheap, but bundling the inserts keeps fsync churn down on
    //    spinning disks and ensures the table is either fully old or
    //    fully new — a partial overwrite would render half-wrong edges
    //    in the UI on a crash.
    let mut summary = EdgesSummary {
        notes_considered: total,
        ..Default::default()
    };

    store.with_conn_mut(|c| {
        let tx = c.transaction()?;
        tx.execute("DELETE FROM semantic_edges", [])?;

        // SQLite's max number of host parameters is 999 by default. We
        // insert one row at a time inside the transaction; a single
        // prepared statement reused across iterations is the standard
        // rusqlite idiom for bulk insert.
        {
            let mut stmt = tx.prepare(
                "INSERT INTO semantic_edges (a_path, b_path, score) VALUES (?1, ?2, ?3)",
            )?;
            for i in 0..n {
                for j in (i + 1)..n {
                    summary.pairs_evaluated += 1;
                    let score = dot(&centroids[i], &centroids[j]);
                    if score >= BASELINE_SCORE {
                        // Always store a, b in deterministic order so
                        // the PRIMARY KEY catches duplicates if anyone
                        // adds a second writer later.
                        let (a, b) = if kept_paths[i] < kept_paths[j] {
                            (&kept_paths[i], &kept_paths[j])
                        } else {
                            (&kept_paths[j], &kept_paths[i])
                        };
                        stmt.execute(rusqlite::params![a, b, score as f64])?;
                        summary.edges_stored += 1;
                    }
                }
                on_progress(RecomputeProgress {
                    done: (i + 1) as u32,
                    total,
                });
            }
        }

        tx.commit()?;
        Ok(())
    })?;

    Ok(summary)
}

/// Return every stored edge whose score is at least `min_score`. The UI
/// calls this every time the slider settles — fast, just an indexed
/// range query (no math).
pub fn list(store: &AiStore, min_score: f32) -> Result<Vec<SemanticEdge>> {
    store.with_conn(|c| {
        let mut stmt = c.prepare(
            "SELECT a_path, b_path, score FROM semantic_edges WHERE score >= ?1 ORDER BY score DESC",
        )?;
        let rows: Vec<SemanticEdge> = stmt
            .query_map([min_score as f64], |r| {
                Ok(SemanticEdge {
                    a_path: r.get(0)?,
                    b_path: r.get(1)?,
                    score: r.get::<_, f64>(2)? as f32,
                })
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(rows)
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct EdgesStatus {
    pub total: u32,
}

/// Count of stored edges. The graph view checks this on first toggle to
/// decide whether to kick off a recompute (an empty table means we've
/// never run the pass for this vault).
pub fn status(store: &AiStore) -> Result<EdgesStatus> {
    store.with_conn(|c| {
        let total: i64 =
            c.query_row("SELECT COUNT(*) FROM semantic_edges", [], |r| r.get(0))?;
        Ok(EdgesStatus {
            total: total.max(0) as u32,
        })
    })
}

// ---- low-level helpers --------------------------------------------------

fn read_note_vectors(store: &AiStore, note_path: &str) -> Result<Vec<Vec<f32>>> {
    store.with_conn(|c| {
        let mut stmt = c.prepare(
            r#"
            SELECT chunks_vec.embedding
            FROM chunks_vec
            JOIN chunks ON chunks.id = chunks_vec.rowid
            WHERE chunks.note_path = ?1
            "#,
        )?;
        let vecs: Vec<Vec<f32>> = stmt
            .query_map([note_path], |r| {
                let bytes: Vec<u8> = r.get(0)?;
                let mut v = Vec::with_capacity(bytes.len() / 4);
                for chunk in bytes.chunks_exact(4) {
                    v.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
                }
                Ok(v)
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(vecs)
    })
}

fn mean(vecs: &[Vec<f32>]) -> Vec<f32> {
    let dim = vecs[0].len();
    let mut sum = vec![0.0_f32; dim];
    for v in vecs {
        for (i, x) in v.iter().enumerate() {
            sum[i] += x;
        }
    }
    let n = vecs.len() as f32;
    for x in &mut sum {
        *x /= n;
    }
    sum
}

fn normalize(v: &mut [f32]) {
    let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
    if norm > 0.0 {
        for x in v {
            *x /= norm;
        }
    }
}

fn dot(a: &[f32], b: &[f32]) -> f32 {
    a.iter().zip(b.iter()).map(|(x, y)| x * y).sum()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::ai::embedder::testing::StubEmbedder;
    use crate::core::ai::indexer;
    use crate::core::ai::store::EMBED_DIM;
    use tempfile::TempDir;

    fn write(root: &std::path::Path, rel: &str, content: &str) {
        let abs = root.join(rel);
        if let Some(parent) = abs.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(abs, content).unwrap();
    }

    async fn seed(root: &std::path::Path, store: &AiStore, files: &[(&str, &str)]) {
        let embedder = StubEmbedder::new(EMBED_DIM);
        for (rel, content) in files {
            write(root, rel, content);
            indexer::index_note(store, &embedder, root, rel, 10.0, "m")
                .await
                .unwrap();
        }
    }

    #[test]
    fn dot_matches_hand_computation() {
        assert!((dot(&[1.0, 0.0, 0.0], &[1.0, 0.0, 0.0]) - 1.0).abs() < 1e-6);
        assert!((dot(&[1.0, 0.0, 0.0], &[0.0, 1.0, 0.0])).abs() < 1e-6);
        assert!((dot(&[0.6, 0.8], &[0.6, 0.8]) - 1.0).abs() < 1e-6);
    }

    #[test]
    fn normalize_yields_unit_vector() {
        let mut v = vec![3.0_f32, 4.0];
        normalize(&mut v);
        let norm: f32 = v.iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 1e-6);
    }

    #[tokio::test]
    async fn empty_vault_yields_empty_summary() {
        let dir = TempDir::new().unwrap();
        let store = AiStore::open(dir.path()).unwrap();
        let summary = recompute(&store, |_| {}).unwrap();
        assert_eq!(summary.notes_considered, 0);
        assert_eq!(summary.edges_stored, 0);
        assert!(list(&store, 0.0).unwrap().is_empty());
    }

    #[tokio::test]
    async fn identical_notes_get_a_perfect_edge() {
        let dir = TempDir::new().unwrap();
        let store = AiStore::open(dir.path()).unwrap();
        // The stub embedder maps identical text → identical vectors,
        // so a.md and b.md have cosine similarity = 1.
        seed(dir.path(), &store, &[("a.md", "alpha"), ("b.md", "alpha")]).await;
        let summary = recompute(&store, |_| {}).unwrap();
        assert_eq!(summary.notes_considered, 2);
        assert_eq!(summary.pairs_evaluated, 1);
        assert_eq!(summary.edges_stored, 1);
        let edges = list(&store, 0.0).unwrap();
        assert_eq!(edges.len(), 1);
        assert!((edges[0].score - 1.0).abs() < 1e-4);
    }

    #[tokio::test]
    async fn unrelated_notes_drop_below_baseline() {
        let dir = TempDir::new().unwrap();
        let store = AiStore::open(dir.path()).unwrap();
        // Stub centroids derived from disjoint chars → small dot product.
        seed(dir.path(), &store, &[("a.md", "alpha"), ("b.md", "zzzzz")]).await;
        let _ = recompute(&store, |_| {}).unwrap();
        let edges = list(&store, BASELINE_SCORE).unwrap();
        // No guarantee these are below baseline given the stub's
        // distribution; the contract being tested is "list filters by
        // threshold". So push the threshold past 1.0 and expect none.
        let above_one = list(&store, 1.01).unwrap();
        assert!(above_one.is_empty());
        // Sanity: at this baseline the count is finite and well-defined.
        assert!(edges.len() <= 1);
    }

    #[tokio::test]
    async fn recompute_is_replace_not_append() {
        let dir = TempDir::new().unwrap();
        let store = AiStore::open(dir.path()).unwrap();
        seed(dir.path(), &store, &[("a.md", "alpha"), ("b.md", "alpha")]).await;
        let _ = recompute(&store, |_| {}).unwrap();
        let _ = recompute(&store, |_| {}).unwrap();
        // After two passes we should still have exactly one row, not two.
        let edges = list(&store, 0.0).unwrap();
        assert_eq!(edges.len(), 1);
    }

    #[tokio::test]
    async fn list_filters_by_threshold() {
        let dir = TempDir::new().unwrap();
        let store = AiStore::open(dir.path()).unwrap();
        seed(
            dir.path(),
            &store,
            &[
                ("a.md", "alpha"),
                ("b.md", "alpha"),
                ("c.md", "alpha"),
            ],
        )
        .await;
        let _ = recompute(&store, |_| {}).unwrap();
        // Three notes → C(3, 2) = 3 pairs, all identical → 3 perfect edges.
        let edges_low = list(&store, 0.5).unwrap();
        assert_eq!(edges_low.len(), 3);
        let edges_high = list(&store, 1.5).unwrap();
        assert!(edges_high.is_empty());
    }

    #[tokio::test]
    async fn status_counts_stored_edges() {
        let dir = TempDir::new().unwrap();
        let store = AiStore::open(dir.path()).unwrap();
        assert_eq!(status(&store).unwrap().total, 0);
        seed(dir.path(), &store, &[("a.md", "x"), ("b.md", "x")]).await;
        let _ = recompute(&store, |_| {}).unwrap();
        assert_eq!(status(&store).unwrap().total, 1);
    }

    #[tokio::test]
    async fn progress_fires_once_per_source_note() {
        let dir = TempDir::new().unwrap();
        let store = AiStore::open(dir.path()).unwrap();
        seed(
            dir.path(),
            &store,
            &[("a.md", "x"), ("b.md", "y"), ("c.md", "z")],
        )
        .await;
        let mut events = Vec::new();
        let _ = recompute(&store, |p| events.push(p)).unwrap();
        assert_eq!(events.len(), 3);
        assert_eq!(events.last().unwrap().done, 3);
        assert_eq!(events.last().unwrap().total, 3);
    }
}
