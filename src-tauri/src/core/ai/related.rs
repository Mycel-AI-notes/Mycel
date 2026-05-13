//! "Related notes" for a single open note.
//!
//! Strategy: every chunk of the current note already lives in `chunks_vec`,
//! so we don't need OpenRouter at all — Phase 4 is **free**. We average
//! the chunk vectors into a note-level centroid and run kNN against the
//! whole table, then dedupe by note path and drop the self-match.
//!
//! Caveats of the centroid approach:
//!   - Long, topically diverse notes get a "blurred" centroid that
//!     under-represents minority topics. For MVP-2 this is fine; the
//!     follow-up if it ever matters is to score each chunk individually
//!     against the candidate and use the max similarity (max-pool over
//!     chunks). Mentioned here so a future contributor knows the lever
//!     exists.
//!
//! Encoding note: `chunks_vec` stores embeddings as little-endian f32
//! BLOBs (sqlite-vec's native binary format). We parse them directly
//! rather than round-tripping through `vec_to_json`, which would cost
//! a JSON parse on every read for a function that's already on the
//! hot path of the right-sidebar refresh.

use anyhow::Result;
use serde::Serialize;

use super::store::AiStore;

#[derive(Debug, Clone, Serialize)]
pub struct RelatedHit {
    pub note_path: String,
    /// Cosine distance to the source note's centroid (smaller is more
    /// similar). The UI turns this into a horizontal "confidence bar"
    /// width.
    pub distance: f32,
}

pub fn find_related(
    store: &AiStore,
    note_path: &str,
    k: usize,
) -> Result<Vec<RelatedHit>> {
    let vecs = read_note_vectors(store, note_path)?;
    if vecs.is_empty() {
        // Note isn't indexed (encrypted, brand-new, or AI was off when
        // it was last saved). Returning [] lets the UI render "no
        // related notes" or hide the section entirely — caller's call.
        return Ok(Vec::new());
    }
    let centroid = mean(&vecs);
    let json = encode_vec_json(&centroid);

    // 6× headroom so dedupe-by-note and self-exclusion don't shrink the
    // visible list. Capped at 100 — anything past that is pure noise
    // for the right-sidebar UI.
    let chunk_k = (k.saturating_mul(6)).min(100).max(k + 1);

    let raw: Vec<(String, f32)> = store.with_conn(|c| {
        let mut stmt = c.prepare(
            r#"
            SELECT chunks.note_path, chunks_vec.distance
            FROM chunks_vec
            JOIN chunks ON chunks.id = chunks_vec.rowid
            WHERE chunks_vec.embedding MATCH ?1 AND k = ?2
            ORDER BY chunks_vec.distance
            "#,
        )?;
        let rows = stmt
            .query_map(rusqlite::params![json, chunk_k as i64], |r| {
                Ok((
                    r.get::<_, String>(0)?,
                    r.get::<_, f64>(1)? as f32,
                ))
            })?
            .filter_map(|r| r.ok())
            .collect::<Vec<_>>();
        Ok(rows)
    })?;

    // Dedupe by note_path; the first occurrence is best (rows already
    // arrive ordered by distance ASC). Seed the seen set with the self
    // path so a note never appears as its own neighbor.
    let mut seen = std::collections::HashSet::new();
    seen.insert(note_path.to_string());
    let mut out = Vec::with_capacity(k);
    for (path, dist) in raw {
        if seen.insert(path.clone()) {
            out.push(RelatedHit {
                note_path: path,
                distance: dist,
            });
            if out.len() >= k {
                break;
            }
        }
    }
    Ok(out)
}

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
                Ok(bytes_to_f32_le(&bytes))
            })?
            .filter_map(|r| r.ok())
            .collect();
        Ok(vecs)
    })
}

fn bytes_to_f32_le(bytes: &[u8]) -> Vec<f32> {
    let mut v = Vec::with_capacity(bytes.len() / 4);
    for chunk in bytes.chunks_exact(4) {
        v.push(f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]));
    }
    v
}

fn mean(vecs: &[Vec<f32>]) -> Vec<f32> {
    // Caller guarantees `vecs` is non-empty (we early-return above when
    // the note has no chunks).
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

fn encode_vec_json(v: &[f32]) -> String {
    // Same encoding the indexer + search modules use. Inlined rather
    // than shared: three call sites is too few to justify a helper
    // module, and inlining keeps each module reviewable in isolation.
    let mut s = String::with_capacity(v.len() * 8 + 2);
    s.push('[');
    for (i, x) in v.iter().enumerate() {
        if i > 0 {
            s.push(',');
        }
        s.push_str(&format!("{:.6}", x));
    }
    s.push(']');
    s
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
            indexer::index_note(store, &embedder, root, rel, 10.0, "test-model")
                .await
                .unwrap();
        }
    }

    #[tokio::test]
    async fn empty_for_unindexed_path() {
        let dir = TempDir::new().unwrap();
        let store = AiStore::open(dir.path()).unwrap();
        let hits = find_related(&store, "ghost.md", 5).unwrap();
        assert!(hits.is_empty());
    }

    #[tokio::test]
    async fn excludes_self_from_results() {
        let dir = TempDir::new().unwrap();
        let store = AiStore::open(dir.path()).unwrap();
        seed(
            dir.path(),
            &store,
            &[
                ("a.md", "alpha apple anchor"),
                ("b.md", "alpha apple anchor"), // identical to a.md
                ("c.md", "completely different zebra"),
            ],
        )
        .await;

        let hits = find_related(&store, "a.md", 5).unwrap();
        // Should return at most 2 (b.md and c.md), and never a.md.
        assert!(hits.iter().all(|h| h.note_path != "a.md"));
        assert!(!hits.is_empty());
    }

    #[tokio::test]
    async fn dedupes_multi_chunk_neighbors() {
        let dir = TempDir::new().unwrap();
        let store = AiStore::open(dir.path()).unwrap();
        // `long.md` has many chunks; the result list must list it once,
        // not once-per-chunk.
        seed(
            dir.path(),
            &store,
            &[
                ("source.md", "alpha beta gamma"),
                ("long.md", &"alpha beta gamma ".repeat(500)),
                ("other.md", "alpha"),
            ],
        )
        .await;

        let hits = find_related(&store, "source.md", 5).unwrap();
        let unique: std::collections::HashSet<_> =
            hits.iter().map(|h| &h.note_path).collect();
        assert_eq!(unique.len(), hits.len(), "duplicates in results");
    }

    #[tokio::test]
    async fn returns_at_most_k() {
        let dir = TempDir::new().unwrap();
        let store = AiStore::open(dir.path()).unwrap();
        let files: Vec<(String, String)> = (0..10)
            .map(|i| (format!("n{i}.md"), format!("content number {i}")))
            .collect();
        let refs: Vec<(&str, &str)> = files
            .iter()
            .map(|(a, b)| (a.as_str(), b.as_str()))
            .collect();
        seed(dir.path(), &store, &refs).await;

        let hits = find_related(&store, "n0.md", 3).unwrap();
        assert_eq!(hits.len(), 3);
    }

    #[tokio::test]
    async fn results_ordered_by_distance_ascending() {
        let dir = TempDir::new().unwrap();
        let store = AiStore::open(dir.path()).unwrap();
        seed(
            dir.path(),
            &store,
            &[
                ("src.md", "alpha beta gamma"),
                ("near.md", "alpha beta delta"),
                ("far.md",  "xyz qrs tuv"),
            ],
        )
        .await;

        let hits = find_related(&store, "src.md", 5).unwrap();
        for w in hits.windows(2) {
            assert!(
                w[0].distance <= w[1].distance,
                "results not sorted: {} then {}",
                w[0].distance,
                w[1].distance
            );
        }
    }

    #[test]
    fn mean_averages_componentwise() {
        let v = vec![vec![1.0_f32, 3.0], vec![3.0_f32, 5.0]];
        assert_eq!(mean(&v), vec![2.0_f32, 4.0]);
    }

    #[test]
    fn bytes_round_trip_through_le_f32() {
        let expected = [0.5_f32, -1.25, 7.0, 0.0];
        let bytes: Vec<u8> = expected
            .iter()
            .flat_map(|f| f.to_le_bytes())
            .collect();
        assert_eq!(bytes_to_f32_le(&bytes), expected.to_vec());
    }
}
