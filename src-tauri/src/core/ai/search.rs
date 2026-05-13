//! Semantic search over indexed chunks.
//!
//! Pipeline:
//!   1. Embed the query string (one OpenRouter call, ~$0.000001 each).
//!   2. kNN against `chunks_vec` via sqlite-vec's `MATCH` operator,
//!      asking for 3× the user-visible `k` so we have headroom to
//!      dedupe by note.
//!   3. Group by `note_path`, keep the chunk with the smallest
//!      distance per note. Returns up to `k` notes.
//!
//! Returns the *best chunk text* alongside each note so the UI can
//! render a snippet without making a second call.

use anyhow::Result;
use serde::Serialize;

use super::budget;
use super::embedder::{estimate_cost_usd, Embedder};
use super::store::AiStore;

#[derive(Debug, Clone, Serialize)]
pub struct SemanticHit {
    pub note_path: String,
    pub chunk_text: String,
    /// Cosine distance (sqlite-vec default for float vectors). Smaller
    /// is more similar, range [0, 2]. We expose it for the UI to badge
    /// confidence; ranking itself doesn't need it (RRF uses ranks).
    pub distance: f32,
}

pub async fn semantic_search(
    store: &AiStore,
    embedder: &dyn Embedder,
    query: &str,
    k: usize,
    daily_budget_usd: f64,
    model: &str,
) -> Result<Vec<SemanticHit>> {
    let trimmed = query.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }

    // Estimate before the call so a query made with the budget already
    // blown returns cleanly instead of consuming a (tiny) request that
    // would tip us into a hard ban. We use the same 1-token-per-4-chars
    // rule the indexer uses.
    let est_tokens = (trimmed.chars().count() / 4).max(1) as u64;
    budget::check(store, daily_budget_usd, model, estimate_cost_usd(est_tokens))?;

    let batch = embedder.embed(&[trimmed.to_string()]).await?;
    anyhow::ensure!(
        batch.vectors.len() == 1,
        "embedder returned {} vectors for one input",
        batch.vectors.len()
    );
    let query_vec = &batch.vectors[0];
    anyhow::ensure!(
        query_vec.len() == embedder.dim(),
        "query embedding dim mismatch"
    );

    let cost = estimate_cost_usd(batch.tokens_in);
    budget::record(store, model, batch.tokens_in, 0, cost)?;

    // Ask for 3× headroom so dedupe-by-note doesn't return fewer notes
    // than the user expects when a single note dominates the top of the
    // raw chunk list. Capped at 60 for sanity — anything past that is
    // noise for a UI list.
    let chunk_k = (k.saturating_mul(3)).min(60).max(k);
    let json = encode_vec_json(query_vec);

    let raw: Vec<(String, String, f32)> = store.with_conn(|c| {
        let mut stmt = c.prepare(
            r#"
            SELECT chunks.note_path,
                   chunks.text,
                   chunks_vec.distance
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
                    r.get::<_, String>(1)?,
                    r.get::<_, f64>(2)? as f32,
                ))
            })?
            .filter_map(|r| r.ok())
            .collect::<Vec<_>>();
        Ok(rows)
    })?;

    // Dedupe by note_path keeping the best (smallest distance) chunk.
    // Iteration order is already by ascending distance from the SQL
    // `ORDER BY`, so the first time we see a path is also the best.
    let mut seen = std::collections::HashSet::new();
    let mut out = Vec::with_capacity(k);
    for (note_path, chunk_text, distance) in raw {
        if seen.insert(note_path.clone()) {
            out.push(SemanticHit {
                note_path,
                chunk_text,
                distance,
            });
            if out.len() >= k {
                break;
            }
        }
    }
    Ok(out)
}

fn encode_vec_json(v: &[f32]) -> String {
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
    async fn empty_query_returns_nothing() {
        let dir = TempDir::new().unwrap();
        let store = AiStore::open(dir.path()).unwrap();
        let embedder = StubEmbedder::new(EMBED_DIM);
        let hits = semantic_search(&store, &embedder, "  ", 10, 10.0, "m")
            .await
            .unwrap();
        assert!(hits.is_empty());
    }

    #[tokio::test]
    async fn finds_the_nearest_indexed_note() {
        let dir = TempDir::new().unwrap();
        let store = AiStore::open(dir.path()).unwrap();
        seed(
            dir.path(),
            &store,
            &[
                ("a.md", "alpha apple anchor"),
                ("b.md", "zebra zephyr zenith"),
            ],
        )
        .await;

        // The stub embedder maps each input to a vector derived from its
        // chars; querying with content closest to "alpha apple…" should
        // surface a.md first.
        let embedder = StubEmbedder::new(EMBED_DIM);
        let hits = semantic_search(&store, &embedder, "alpha apple anchor", 5, 10.0, "m")
            .await
            .unwrap();
        assert!(!hits.is_empty());
        assert_eq!(hits[0].note_path, "a.md");
    }

    #[tokio::test]
    async fn dedupes_by_note_path() {
        // A long note has many chunks; the same path shouldn't fill all
        // top-k slots.
        let dir = TempDir::new().unwrap();
        let store = AiStore::open(dir.path()).unwrap();
        seed(
            dir.path(),
            &store,
            &[
                ("long.md", &"alpha beta gamma ".repeat(500)),
                ("short.md", "alpha"),
            ],
        )
        .await;
        let embedder = StubEmbedder::new(EMBED_DIM);
        let hits = semantic_search(&store, &embedder, "alpha", 5, 10.0, "m").await.unwrap();
        // Each note appears at most once even though long.md has many chunks.
        let paths: Vec<_> = hits.iter().map(|h| &h.note_path).collect();
        let unique: std::collections::HashSet<_> = paths.iter().collect();
        assert_eq!(paths.len(), unique.len());
    }

    #[tokio::test]
    async fn returns_at_most_k_notes() {
        let dir = TempDir::new().unwrap();
        let store = AiStore::open(dir.path()).unwrap();
        let files: Vec<(String, String)> = (0..10)
            .map(|i| (format!("n{i}.md"), format!("content number {i}")))
            .collect();
        let refs: Vec<(&str, &str)> = files.iter().map(|(a, b)| (a.as_str(), b.as_str())).collect();
        seed(dir.path(), &store, &refs).await;

        let embedder = StubEmbedder::new(EMBED_DIM);
        let hits = semantic_search(&store, &embedder, "content", 3, 10.0, "m").await.unwrap();
        assert_eq!(hits.len(), 3);
    }

    #[tokio::test]
    async fn budget_exhaustion_short_circuits_before_embed() {
        let dir = TempDir::new().unwrap();
        let store = AiStore::open(dir.path()).unwrap();
        budget::record(&store, "m", 0, 0, 1.5).unwrap();
        let embedder = StubEmbedder::new(EMBED_DIM);
        let result = semantic_search(&store, &embedder, "anything", 5, 1.0, "m").await;
        assert!(result.is_err());
        assert!(result.unwrap_err().to_string().contains("budget"));
        // Stub records calls; the embedder must not have been hit.
        assert!(embedder.calls.lock().unwrap().is_empty());
    }
}
