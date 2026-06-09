//! "This quick note looks like it belongs in that note."
//!
//! The auto-filing detector from `docs/specs/quick-note-filing.md`. It walks
//! the quick-capture folder, and for every settled note (old enough, not yet
//! filed, non-empty) asks the embedding index where it belongs. The top
//! match above the user's threshold becomes one `QuickNoteFiling` card whose
//! primary action is a confirmed, atomic merge (`quick_note_merge`).
//!
//! Rides entirely on the MVP-2 embedding index — no OpenRouter calls, so
//! `requires_llm()` stays false. Quick notes that aren't indexed yet are
//! skipped this run; the scheduler's pre-run reindex catches them next time.
//!
//! Note: `similar_notes_min_words` deliberately does NOT apply here. Quick
//! notes are short by nature — the word gate would exclude this feature's
//! entire input. Noise is controlled by the similarity threshold and the
//! engine's quotas instead.

use std::collections::HashSet;
use std::time::{Duration, SystemTime};

use async_trait::async_trait;
use walkdir::WalkDir;

use super::util::{base_name, similarity};
use crate::core::ai::insights::detector::{stable_id, Detector, DetectorContext};
use crate::core::ai::insights::models::{Insight, InsightAction, InsightKind};
use crate::core::ai::related::find_related;
use crate::core::quick_filing as qf;
use crate::core::vault::QUICK_NOTES_DIR;

/// Neighbours fetched per quick note before target filtering.
const K: usize = 8;

/// Characters of the quick note shown on the card as a preview.
const PREVIEW_CHARS: usize = 200;

pub struct QuickFilingDetector;

#[async_trait]
impl Detector for QuickFilingDetector {
    fn name(&self) -> &'static str {
        "quick_note_filing"
    }

    async fn run(&self, ctx: &DetectorContext<'_>) -> anyhow::Result<Vec<Insight>> {
        let min_similarity =
            (ctx.settings.quick_filing_min_similarity.min(100) as f32) / 100.0;
        let min_age =
            Duration::from_secs(ctx.settings.quick_filing_min_age_minutes as u64 * 60);
        let now = SystemTime::now();

        let mut out = Vec::new();
        let generated_at = chrono::Utc::now().timestamp();

        // One query up front instead of one per candidate.
        let indexed = indexed_quick_paths(ctx)?;

        for cand in candidates(ctx, now, min_age) {
            // Skip anything the index hasn't seen yet — the detector never
            // embeds on its own (that's the scheduler's pre-run reindex job).
            if !indexed.contains(&cand.path) {
                continue;
            }

            // Targets the note already wikilinks to are never suggested;
            // parse the links once per candidate, not once per neighbour.
            let linked = wikilink_basenames(&cand.body);
            let Some((target, confidence)) =
                best_target(ctx, &cand.path, &linked, min_similarity)?
            else {
                continue;
            };

            let quick_path = cand.path;
            let preview: String = cand.body.chars().take(PREVIEW_CHARS).collect();
            let ellipsis =
                if cand.body.chars().count() > PREVIEW_CHARS { "…" } else { "" };
            let captured = qf::capture_timestamp(&quick_path)
                .unwrap_or_else(|| "earlier".to_string());

            let target_base = base_name(&target);
            let note_paths = vec![quick_path.clone(), target.clone()];
            out.push(Insight {
                id: stable_id(
                    InsightKind::QuickNoteFiling.as_key(),
                    std::slice::from_ref(&quick_path),
                    &[&target],
                ),
                kind: InsightKind::QuickNoteFiling,
                confidence,
                title: format!("File quick note → {target_base}"),
                body: format!(
                    "This quick note from {captured} looks like it belongs in \
                     [[{target_base}]]. Merge it there and clear it from your \
                     quick folder?\n\n{preview}{ellipsis}"
                ),
                note_paths: note_paths.clone(),
                actions: vec![
                    InsightAction::MergeQuickNote {
                        source: quick_path,
                        target,
                    },
                    InsightAction::OpenSideBySide { note_paths },
                ],
                external_refs: vec![],
                generated_at,
            });
        }
        Ok(out)
    }
}

/// One eligible quick note, with its body kept so `run` doesn't read the
/// file a second time for the card preview.
struct Candidate {
    path: String,
    body: String,
}

/// Quick notes eligible for filing: plain `.md` under `quick/`, old enough,
/// not marked `filed_to:`, and with a non-empty body.
fn candidates(
    ctx: &DetectorContext<'_>,
    now: SystemTime,
    min_age: Duration,
) -> Vec<Candidate> {
    let quick_root = ctx.vault_root.join(QUICK_NOTES_DIR);
    let mut out = Vec::new();
    for entry in WalkDir::new(&quick_root)
        .into_iter()
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_file())
    {
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("md") {
            continue; // skips `.md.age` too — its extension is `age`
        }
        let Ok(rel_os) = path.strip_prefix(ctx.vault_root) else {
            continue;
        };
        // Index paths are vault-relative with `/` separators on every OS.
        let rel = rel_os
            .components()
            .filter_map(|c| c.as_os_str().to_str())
            .collect::<Vec<_>>()
            .join("/");

        let fresh = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|t| now.duration_since(t).ok())
            .map(|age| age < min_age)
            // No readable mtime → treat as fresh and skip; better to miss a
            // run than to suggest filing a note that's mid-edit.
            .unwrap_or(true);
        if fresh {
            continue;
        }

        let Ok(raw) = std::fs::read_to_string(path) else {
            continue;
        };
        if qf::has_filed_marker(&raw) {
            continue;
        }
        let body = qf::note_body(&raw, &rel);
        if body.is_empty() {
            continue;
        }
        out.push(Candidate { path: rel, body });
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out
}

/// Every quick note the embedding index knows about, in one query.
fn indexed_quick_paths(ctx: &DetectorContext<'_>) -> anyhow::Result<HashSet<String>> {
    let pattern = format!("{QUICK_NOTES_DIR}/%");
    ctx.store.with_conn(|c| {
        let mut stmt =
            c.prepare("SELECT DISTINCT note_path FROM chunks WHERE note_path LIKE ?1")?;
        let rows = stmt
            .query_map([pattern.as_str()], |r| r.get::<_, String>(0))?
            .filter_map(|r| r.ok())
            .collect();
        Ok(rows)
    })
}

/// Lowercased base names of every wikilink target in `body` (heading
/// anchors stripped) — the same comparison `util::links_to` makes, computed
/// once instead of re-parsing the note for every neighbour.
fn wikilink_basenames(body: &str) -> HashSet<String> {
    crate::core::parser::parse_note(body)
        .wikilinks
        .iter()
        .map(|wl| {
            let t = wl.target.split('#').next().unwrap_or(&wl.target);
            base_name(t).to_lowercase()
        })
        .collect()
}

/// Best merge target for one quick note, or `None` when nothing clears the
/// threshold. Other quick notes, encrypted notes, and targets in `linked`
/// (already wikilinked from the note) are never suggested.
fn best_target(
    ctx: &DetectorContext<'_>,
    quick_path: &str,
    linked: &HashSet<String>,
    min_similarity: f32,
) -> anyhow::Result<Option<(String, f32)>> {
    let hits = find_related(&ctx.store, quick_path, K)?;
    for hit in hits {
        // Hits arrive ordered by distance, so the first survivor is the best.
        if qf::is_quick_path(&hit.note_path) || !hit.note_path.ends_with(".md") {
            continue;
        }
        let sim = similarity(hit.distance);
        if sim < min_similarity {
            // Ordered by distance: everything after this is weaker too.
            return Ok(None);
        }
        if linked.contains(&base_name(&hit.note_path).to_lowercase()) {
            continue;
        }
        return Ok(Some((hit.note_path, sim)));
    }
    Ok(None)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::ai::embedder::testing::StubEmbedder;
    use crate::core::ai::indexer;
    use crate::core::ai::insights::settings::InsightsSettings;
    use crate::core::ai::store::{AiStore, EMBED_DIM};
    use std::path::Path;
    use std::sync::Arc;
    use tempfile::TempDir;

    fn write(root: &Path, rel: &str, content: &str) {
        let abs = root.join(rel);
        if let Some(parent) = abs.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        std::fs::write(abs, content).unwrap();
    }

    /// Push a file's mtime far enough into the past to clear any age gate.
    fn age_file(root: &Path, rel: &str) {
        let abs = root.join(rel);
        let old = SystemTime::now() - Duration::from_secs(60 * 60 * 24);
        let f = std::fs::File::options().write(true).open(&abs).unwrap();
        f.set_modified(old).unwrap();
    }

    async fn seed(root: &Path, store: &AiStore, files: &[(&str, &str)]) {
        let embedder = StubEmbedder::new(EMBED_DIM);
        for (rel, content) in files {
            write(root, rel, content);
            age_file(root, rel);
            indexer::index_note(store, &embedder, root, rel, 10.0, "test-model")
                .await
                .unwrap();
        }
    }

    fn ctx<'a>(
        store: &Arc<AiStore>,
        root: &'a Path,
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

    /// Defaults, minus the age gate — most tests create files "now" and care
    /// about matching, not freshness (which has its own test).
    fn test_settings() -> InsightsSettings {
        InsightsSettings {
            quick_filing_min_age_minutes: 0,
            ..InsightsSettings::default()
        }
    }

    const QUICK: &str = "quick/2026-06-09/14-32-08.md";

    #[tokio::test]
    async fn empty_when_nothing_indexed() {
        let dir = TempDir::new().unwrap();
        let store = Arc::new(AiStore::open(dir.path()).unwrap());
        let settings = test_settings();
        let got = QuickFilingDetector
            .run(&ctx(&store, dir.path(), &settings))
            .await
            .unwrap();
        assert!(got.is_empty());
    }

    #[tokio::test]
    async fn files_quick_note_into_matching_target() {
        let dir = TempDir::new().unwrap();
        let store = Arc::new(AiStore::open(dir.path()).unwrap());
        let settings = test_settings();
        // The stub embedder maps equal text to equal vectors → distance 0.
        seed(
            dir.path(),
            &store,
            &[
                (QUICK, "prune the apple trees before spring"),
                ("orchard.md", "prune the apple trees before spring"),
            ],
        )
        .await;

        let got = QuickFilingDetector
            .run(&ctx(&store, dir.path(), &settings))
            .await
            .unwrap();

        assert_eq!(got.len(), 1, "expected one filing card");
        let ins = &got[0];
        assert_eq!(ins.kind, InsightKind::QuickNoteFiling);
        assert_eq!(ins.note_paths, vec![QUICK.to_string(), "orchard.md".to_string()]);
        assert!(ins.confidence > 0.9, "identical text → high confidence");
        assert!(matches!(
            &ins.actions[0],
            InsightAction::MergeQuickNote { source, target }
                if source == QUICK && target == "orchard.md"
        ));
        assert!(ins
            .actions
            .iter()
            .any(|a| matches!(a, InsightAction::OpenSideBySide { .. })));
    }

    #[tokio::test]
    async fn never_suggests_another_quick_note_as_target() {
        let dir = TempDir::new().unwrap();
        let store = Arc::new(AiStore::open(dir.path()).unwrap());
        let settings = test_settings();
        seed(
            dir.path(),
            &store,
            &[
                (QUICK, "prune the apple trees"),
                ("quick/2026-06-09/15-00-00.md", "prune the apple trees"),
            ],
        )
        .await;

        let got = QuickFilingDetector
            .run(&ctx(&store, dir.path(), &settings))
            .await
            .unwrap();
        assert!(got.is_empty(), "quick→quick merges are never offered");
    }

    #[tokio::test]
    async fn skips_already_linked_target() {
        let dir = TempDir::new().unwrap();
        let store = Arc::new(AiStore::open(dir.path()).unwrap());
        let settings = test_settings();
        seed(
            dir.path(),
            &store,
            &[
                (QUICK, "prune the apple trees [[orchard]]"),
                ("orchard.md", "prune the apple trees"),
            ],
        )
        .await;

        let got = QuickFilingDetector
            .run(&ctx(&store, dir.path(), &settings))
            .await
            .unwrap();
        assert!(got.is_empty(), "already-linked target must not be suggested");
    }

    #[tokio::test]
    async fn skips_filed_and_empty_notes() {
        let dir = TempDir::new().unwrap();
        let store = Arc::new(AiStore::open(dir.path()).unwrap());
        let settings = test_settings();
        seed(dir.path(), &store, &[("orchard.md", "prune the apple trees")]).await;

        // Kept-after-merge note: marker in frontmatter.
        seed(
            dir.path(),
            &store,
            &[(QUICK, "---\nfiled_to: orchard.md\n---\nprune the apple trees")],
        )
        .await;
        // Untouched capture: auto heading only.
        seed(
            dir.path(),
            &store,
            &[("quick/2026-06-09/15-00-00.md", "# 15-00-00\n\n")],
        )
        .await;

        let got = QuickFilingDetector
            .run(&ctx(&store, dir.path(), &settings))
            .await
            .unwrap();
        assert!(got.is_empty());
    }

    #[tokio::test]
    async fn skips_fresh_notes_under_age_gate() {
        let dir = TempDir::new().unwrap();
        let store = Arc::new(AiStore::open(dir.path()).unwrap());
        // Default settings keep the 30-minute gate.
        let strict = InsightsSettings::default();
        let embedder = StubEmbedder::new(EMBED_DIM);

        write(dir.path(), "orchard.md", "prune the apple trees");
        age_file(dir.path(), "orchard.md");
        indexer::index_note(&store, &embedder, dir.path(), "orchard.md", 10.0, "m")
            .await
            .unwrap();
        // Written "now" — under the gate.
        write(dir.path(), QUICK, "prune the apple trees");
        indexer::index_note(&store, &embedder, dir.path(), QUICK, 10.0, "m")
            .await
            .unwrap();

        let got = QuickFilingDetector
            .run(&ctx(&store, dir.path(), &strict))
            .await
            .unwrap();
        assert!(got.is_empty(), "a note saved seconds ago must not be filed");
    }

    #[tokio::test]
    async fn stable_id_across_runs() {
        let dir = TempDir::new().unwrap();
        let store = Arc::new(AiStore::open(dir.path()).unwrap());
        let settings = test_settings();
        seed(
            dir.path(),
            &store,
            &[
                (QUICK, "prune the apple trees"),
                ("orchard.md", "prune the apple trees"),
            ],
        )
        .await;

        let c = ctx(&store, dir.path(), &settings);
        let first = QuickFilingDetector.run(&c).await.unwrap();
        let second = QuickFilingDetector.run(&c).await.unwrap();
        assert_eq!(first.len(), 1);
        assert_eq!(second.len(), 1);
        assert_eq!(first[0].id, second[0].id, "id must be stable across runs");
    }
}
