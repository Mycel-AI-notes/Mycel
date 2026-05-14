//! "These two notes look like the same idea, but aren't linked."
//!
//! The first real detector. It rides entirely on the MVP-2 embedding index
//! (`chunks` / `chunks_vec`) — no live OpenRouter calls — so it's free to
//! run and `requires_llm()` stays false. If the vault was never indexed the
//! `chunks` table is empty and the detector simply returns nothing.
//!
//! Algorithm (O(notes · k), not O(notes²)):
//!   1. List every indexed note.
//!   2. For each, kNN against the whole vector table (reuses `find_related`).
//!   3. Convert each neighbour's distance to a 0-100% similarity and keep
//!      pairs at or above the user's `similar_notes_min_similarity` knob.
//!   4. Canonicalise pairs (sorted) so (a,b) and (b,a) collapse.
//!   5. Drop pairs already connected by a wikilink in either direction.
//!   6. Emit one `MissingWikilink` insight per surviving pair.

use std::collections::HashMap;

use async_trait::async_trait;

use crate::core::ai::insights::detector::{stable_id, Detector, DetectorContext};
use crate::core::ai::insights::models::{Insight, InsightAction, InsightKind};
use crate::core::ai::related::find_related;

/// Neighbours fetched per note before pair-filtering.
const K: usize = 6;

/// Map a `chunks_vec` distance to a 0.0-1.0 similarity score. The index
/// stores normalised embeddings, so the distance lands in roughly [0, 2]
/// (identical text ≈ 0). We treat 0 → 1.0 and 2 → 0.0, clamped. The
/// user-facing threshold is a percentage of this.
fn similarity(distance: f32) -> f32 {
    (1.0 - distance / 2.0).clamp(0.0, 1.0)
}

pub struct SimilarNotesDetector;

#[async_trait]
impl Detector for SimilarNotesDetector {
    fn name(&self) -> &'static str {
        "similar_notes"
    }

    async fn run(&self, ctx: &DetectorContext<'_>) -> anyhow::Result<Vec<Insight>> {
        // Only notes with enough indexed text take part. Short stubs (just a
        // title and a line or two) produce noisy, unreliable matches — we
        // skip any pair that touches one by filtering them out up front.
        let substantial =
            substantial_notes(ctx, ctx.settings.similar_notes_min_words as usize)?;
        if substantial.len() < 2 {
            return Ok(Vec::new());
        }

        // Thresholds as 0.0-1.0 fractions. Clamp the stored percentages so a
        // corrupt settings file can't make the detector reject (or accept)
        // everything in a way the UI never showed.
        let min_similarity =
            (ctx.settings.similar_notes_min_similarity.min(100) as f32) / 100.0;
        let duplicate_similarity =
            (ctx.settings.similar_notes_duplicate_similarity.min(100) as f32) / 100.0;

        // Canonical pair -> best (highest) similarity seen.
        let mut pairs: HashMap<(String, String), f32> = HashMap::new();
        for note in &substantial {
            let hits = find_related(&ctx.store, note, K)?;
            for hit in hits {
                // `find_related` searches the whole vector table, so a hit
                // can still be a short note — drop those here too.
                if !substantial.contains(&hit.note_path) {
                    continue;
                }
                let sim = similarity(hit.distance);
                if sim < min_similarity {
                    continue;
                }
                let key = canonical_pair(note, &hit.note_path);
                pairs
                    .entry(key)
                    .and_modify(|s| {
                        if sim > *s {
                            *s = sim;
                        }
                    })
                    .or_insert(sim);
            }
        }

        let now = chrono::Utc::now().timestamp();
        let mut out = Vec::new();
        for ((a, b), confidence) in pairs {
            if already_linked(ctx, &a, &b) {
                continue;
            }
            let note_paths = vec![a.clone(), b.clone()];
            let id = stable_id(InsightKind::MissingWikilink.as_key(), &note_paths, &[]);

            // Above the duplicate cutoff the two notes read as the same page,
            // so "insert a link between them" is the wrong suggestion — offer
            // a keep-one/delete-the-other resolution instead.
            let (title, body, actions) = if confidence >= duplicate_similarity {
                (
                    format!("Possible duplicate: {} ↔ {}", base_name(&a), base_name(&b)),
                    format!(
                        "These two notes look almost identical. Keep one and \
                         remove the other?\n\n- [[{}]]\n- [[{}]]",
                        base_name(&a),
                        base_name(&b),
                    ),
                    vec![
                        InsightAction::OpenSideBySide {
                            note_paths: note_paths.clone(),
                        },
                        InsightAction::ResolveDuplicate {
                            note_paths: note_paths.clone(),
                        },
                    ],
                )
            } else {
                (
                    format!("{} ↔ {}", base_name(&a), base_name(&b)),
                    format!(
                        "These two notes look closely related but aren't \
                         linked. Consider connecting them with a [[wikilink]].\
                         \n\n- [[{}]]\n- [[{}]]",
                        base_name(&a),
                        base_name(&b),
                    ),
                    vec![
                        InsightAction::OpenSideBySide {
                            note_paths: note_paths.clone(),
                        },
                        InsightAction::InsertWikilink {
                            source: a.clone(),
                            target: base_name(&b),
                        },
                    ],
                )
            };

            out.push(Insight {
                id,
                kind: InsightKind::MissingWikilink,
                confidence,
                title,
                body,
                note_paths: note_paths.clone(),
                actions,
                external_refs: vec![],
                generated_at: now,
            });
        }
        Ok(out)
    }
}

/// Indexed notes whose total chunk text is at least `min_words` words.
///
/// Word counts come from the `chunks.text` column rather than re-reading
/// files — the text is already there from indexing, and it's the same text
/// the embeddings were built from, so the count matches what was matched on.
fn substantial_notes(
    ctx: &DetectorContext<'_>,
    min_words: usize,
) -> anyhow::Result<std::collections::HashSet<String>> {
    ctx.store.with_conn(|c| {
        let mut stmt = c.prepare("SELECT note_path, text FROM chunks")?;
        let rows = stmt
            .query_map([], |r| {
                Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?))
            })?
            .filter_map(|r| r.ok());

        let mut words: HashMap<String, usize> = HashMap::new();
        for (path, text) in rows {
            *words.entry(path).or_insert(0) += text.split_whitespace().count();
        }
        Ok(words
            .into_iter()
            .filter(|(_, w)| *w >= min_words)
            .map(|(p, _)| p)
            .collect())
    })
}

/// `(a, b)` with `a <= b` so (x,y) and (y,x) collapse to one key.
fn canonical_pair(a: &str, b: &str) -> (String, String) {
    if a <= b {
        (a.to_string(), b.to_string())
    } else {
        (b.to_string(), a.to_string())
    }
}

/// True if either note already contains a wikilink to the other. Heuristic:
/// we match the wikilink target's base name (case-insensitive) against the
/// other note's base name. Good enough for "is this pair already connected" —
/// a false negative just means we surface a pair the user can dismiss.
fn already_linked(ctx: &DetectorContext<'_>, a: &str, b: &str) -> bool {
    links_to(ctx, a, b) || links_to(ctx, b, a)
}

fn links_to(ctx: &DetectorContext<'_>, from: &str, to: &str) -> bool {
    let path = ctx.vault_root.join(from);
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return false;
    };
    let target_base = base_name(to).to_lowercase();
    let parsed = crate::core::parser::parse_note(&raw);
    parsed.wikilinks.iter().any(|wl| {
        // Strip an optional `#heading` anchor and `.md`, compare base names.
        let t = wl.target.split('#').next().unwrap_or(&wl.target);
        base_name(t).to_lowercase() == target_base
    })
}

/// File stem without directory or `.md` extension: "Projects/Feast.md" → "Feast".
fn base_name(path: &str) -> String {
    let no_dir = path.rsplit('/').next().unwrap_or(path);
    no_dir
        .strip_suffix(".md")
        .unwrap_or(no_dir)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::ai::embedder::testing::StubEmbedder;
    use crate::core::ai::indexer;
    use crate::core::ai::insights::settings::InsightsSettings;
    use crate::core::ai::store::{AiStore, EMBED_DIM};
    use std::sync::Arc;
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

    fn ctx<'a>(
        store: &Arc<AiStore>,
        root: &'a std::path::Path,
        settings: &'a InsightsSettings,
    ) -> DetectorContext<'a> {
        DetectorContext {
            store: store.clone(),
            vault_root: root,
            settings,
            has_llm: false,
            has_web: false,
        }
    }

    /// Default settings, but with the word-count filter disabled — most
    /// tests use short stub notes and care about the matching logic, not
    /// the length gate (which has its own dedicated test).
    fn test_settings() -> InsightsSettings {
        InsightsSettings {
            similar_notes_min_words: 0,
            ..InsightsSettings::default()
        }
    }

    #[tokio::test]
    async fn empty_when_nothing_indexed() {
        let dir = TempDir::new().unwrap();
        let store = Arc::new(AiStore::open(dir.path()).unwrap());
        let settings = test_settings();
        let got = SimilarNotesDetector
            .run(&ctx(&store, dir.path(), &settings))
            .await
            .unwrap();
        assert!(got.is_empty());
    }

    #[tokio::test]
    async fn flags_identical_unlinked_notes() {
        let dir = TempDir::new().unwrap();
        let store = Arc::new(AiStore::open(dir.path()).unwrap());
        let settings = test_settings();
        // Two identical, unlinked notes. The stub embedder maps equal text
        // to equal vectors, so the pair lands at distance 0 → high
        // confidence. (We don't seed an "unrelated" third note here: the
        // stub embedder isn't semantic, so it can't model real
        // dissimilarity — that's covered by the live model in practice.)
        seed(
            dir.path(),
            &store,
            &[
                ("a.md", "feature store architecture and tradeoffs"),
                ("b.md", "feature store architecture and tradeoffs"),
            ],
        )
        .await;

        let got = SimilarNotesDetector
            .run(&ctx(&store, dir.path(), &settings))
            .await
            .unwrap();

        assert_eq!(got.len(), 1, "expected one missing-link pair");
        let mut paths = got[0].note_paths.clone();
        paths.sort();
        assert_eq!(paths, vec!["a.md".to_string(), "b.md".to_string()]);
        assert_eq!(got[0].kind, InsightKind::MissingWikilink);
        assert!(got[0].confidence > 0.5, "identical notes → high confidence");
    }

    #[tokio::test]
    async fn identical_notes_offer_resolve_duplicate() {
        let dir = TempDir::new().unwrap();
        let store = Arc::new(AiStore::open(dir.path()).unwrap());
        let settings = test_settings();
        // Identical content → similarity 1.0, above DUPLICATE_SIMILARITY,
        // so the card must offer "Resolve duplicate", not "Insert link".
        seed(
            dir.path(),
            &store,
            &[
                ("a.md", "feature store architecture and tradeoffs"),
                ("b.md", "feature store architecture and tradeoffs"),
            ],
        )
        .await;

        let got = SimilarNotesDetector
            .run(&ctx(&store, dir.path(), &settings))
            .await
            .unwrap();
        assert_eq!(got.len(), 1);
        let has_resolve = got[0]
            .actions
            .iter()
            .any(|a| matches!(a, InsightAction::ResolveDuplicate { .. }));
        let has_insert = got[0]
            .actions
            .iter()
            .any(|a| matches!(a, InsightAction::InsertWikilink { .. }));
        assert!(has_resolve, "duplicate pair must offer ResolveDuplicate");
        assert!(!has_insert, "duplicate pair must not offer InsertWikilink");
    }

    #[tokio::test]
    async fn skips_notes_below_min_words() {
        let dir = TempDir::new().unwrap();
        let store = Arc::new(AiStore::open(dir.path()).unwrap());
        // Two identical but very short notes (well under 100 words).
        seed(
            dir.path(),
            &store,
            &[
                ("a.md", "feature store architecture"),
                ("b.md", "feature store architecture"),
            ],
        )
        .await;

        // Default settings keep the 100-word gate → the stubs are skipped.
        let strict = InsightsSettings::default();
        let got = SimilarNotesDetector
            .run(&ctx(&store, dir.path(), &strict))
            .await
            .unwrap();
        assert!(got.is_empty(), "short notes must be skipped by the word gate");

        // Drop the gate and the very same pair surfaces.
        let lenient = test_settings();
        let got = SimilarNotesDetector
            .run(&ctx(&store, dir.path(), &lenient))
            .await
            .unwrap();
        assert_eq!(got.len(), 1, "with the gate off the pair is found again");
    }

    #[tokio::test]
    async fn skips_pairs_already_linked() {
        let dir = TempDir::new().unwrap();
        let store = Arc::new(AiStore::open(dir.path()).unwrap());
        let settings = test_settings();
        seed(
            dir.path(),
            &store,
            &[
                ("a.md", "feature store architecture [[b]] and tradeoffs"),
                ("b.md", "feature store architecture and tradeoffs"),
            ],
        )
        .await;

        let got = SimilarNotesDetector
            .run(&ctx(&store, dir.path(), &settings))
            .await
            .unwrap();
        assert!(got.is_empty(), "a.md already links to b.md");
    }

    #[tokio::test]
    async fn stable_id_survives_path_order() {
        let dir = TempDir::new().unwrap();
        let store = Arc::new(AiStore::open(dir.path()).unwrap());
        let settings = test_settings();
        seed(
            dir.path(),
            &store,
            &[
                ("a.md", "shared topic alpha beta"),
                ("b.md", "shared topic alpha beta"),
            ],
        )
        .await;

        let first = SimilarNotesDetector
            .run(&ctx(&store, dir.path(), &settings))
            .await
            .unwrap();
        let second = SimilarNotesDetector
            .run(&ctx(&store, dir.path(), &settings))
            .await
            .unwrap();
        assert_eq!(first.len(), 1);
        assert_eq!(second.len(), 1);
        assert_eq!(first[0].id, second[0].id, "id must be stable across runs");
    }

    #[test]
    fn base_name_strips_dir_and_ext() {
        assert_eq!(base_name("Projects/Feast.md"), "Feast");
        assert_eq!(base_name("flat.md"), "flat");
        assert_eq!(base_name("no-ext"), "no-ext");
    }
}
