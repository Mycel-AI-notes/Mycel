//! The contract every detector implements.
//!
//! Phase 1 ships no real detectors — but the trait is the whole point of the
//! phase: getting it right now means each future detector is one file. The
//! shape is deliberately async (Phase 4+ detectors will hit OpenRouter and
//! Tavily) and deliberately context-bag-style (so we can add `graph`,
//! `activity`, snapshot stores etc. without changing the signature of every
//! existing detector).

use std::path::Path;
use std::sync::Arc;

use async_trait::async_trait;
use sha2::{Digest, Sha256};

use super::models::Insight;
use super::settings::InsightsSettings;
use crate::core::ai::store::AiStore;

/// What a detector gets to read.
///
/// As later phases add a graph index, activity log, and snapshot store, they
/// slot in here without touching detector code that doesn't need them.
pub struct DetectorContext<'a> {
    pub store: Arc<AiStore>,
    pub vault_root: &'a Path,
    /// The live engine settings — detectors read their own tuning knobs
    /// from here (e.g. `similar_notes_min_similarity`).
    pub settings: &'a InsightsSettings,
    /// Whether an OpenRouter key is configured and the master toggle is on.
    /// Detectors that `requires_llm()` are skipped when this is false.
    pub has_llm: bool,
    /// Reserved for Phase 3+. Always false in Phase 1.
    pub has_web: bool,
}

#[async_trait]
pub trait Detector: Send + Sync {
    /// Stable, snake_case identifier. Used as the key in
    /// `InsightsSettings.detectors`, in `insight_telemetry.detector_name`,
    /// and anywhere logs reference "which detector did this".
    fn name(&self) -> &'static str;

    /// What the scheduler should do for a fresh install. Phase 2+ detectors
    /// can return `false` here for anything noisy by default.
    fn enabled_by_default(&self) -> bool {
        true
    }

    fn requires_llm(&self) -> bool {
        false
    }

    fn requires_web(&self) -> bool {
        false
    }

    /// Find insights. Errors are logged and the run continues with the next
    /// detector — one broken detector must not block the whole inbox.
    /// Detectors do not need to dedupe across runs; the engine filters
    /// against the cooldown table before persisting.
    async fn run(&self, ctx: &DetectorContext<'_>) -> anyhow::Result<Vec<Insight>>;
}

/// Cooldown signature: hash of the insight's "is this the same finding?"
/// shape. Two insights with the same kind and the same set of note paths
/// (order-independent) collide here, which is what makes "I dismissed this
/// yesterday" stop the same card from coming back today.
pub fn signature(insight: &Insight) -> String {
    let mut paths = insight.note_paths.clone();
    paths.sort();
    let raw = format!("{}|{}", insight.kind.as_key(), paths.join(","));
    let digest = Sha256::digest(raw.as_bytes());
    hex_encode(&digest)
}

/// Stable id helper for detector authors. `key_fields` is anything that
/// distinguishes two insights of the same kind over the same notes — e.g.
/// for a future "echo" detector, the heading text. Keep it stable across
/// runs, otherwise dismiss-cooldown silently breaks.
pub fn stable_id(kind_key: &str, note_paths: &[String], key_fields: &[&str]) -> String {
    let mut paths: Vec<String> = note_paths.to_vec();
    paths.sort();
    let raw = format!("{}|{}|{}", kind_key, paths.join(","), key_fields.join(":"));
    let digest = Sha256::digest(raw.as_bytes());
    hex_encode(&digest)
}

fn hex_encode(bytes: &[u8]) -> String {
    let mut out = String::with_capacity(bytes.len() * 2);
    for b in bytes {
        out.push_str(&format!("{:02x}", b));
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::ai::insights::models::{InsightAction, InsightKind};

    fn mk(kind: InsightKind, paths: Vec<&str>) -> Insight {
        Insight {
            id: "ignored".into(),
            kind,
            confidence: 0.5,
            title: "t".into(),
            body: "b".into(),
            note_paths: paths.into_iter().map(String::from).collect(),
            actions: vec![InsightAction::OpenNote {
                note_path: "x.md".into(),
            }],
            external_refs: vec![],
            generated_at: 0,
        }
    }

    #[test]
    fn signature_is_stable_across_path_order() {
        let a = mk(InsightKind::MissingWikilink, vec!["a.md", "b.md"]);
        let b = mk(InsightKind::MissingWikilink, vec!["b.md", "a.md"]);
        assert_eq!(signature(&a), signature(&b));
    }

    #[test]
    fn signature_differs_by_kind() {
        let a = mk(InsightKind::MissingWikilink, vec!["a.md", "b.md"]);
        let b = mk(InsightKind::BridgeCandidate, vec!["a.md", "b.md"]);
        assert_ne!(signature(&a), signature(&b));
    }

    #[test]
    fn signature_differs_by_paths() {
        let a = mk(InsightKind::MissingWikilink, vec!["a.md", "b.md"]);
        let b = mk(InsightKind::MissingWikilink, vec!["a.md", "c.md"]);
        assert_ne!(signature(&a), signature(&b));
    }

    #[test]
    fn stable_id_is_deterministic() {
        let id1 = stable_id("missing_wikilink", &["a.md".into(), "b.md".into()], &[]);
        let id2 = stable_id("missing_wikilink", &["b.md".into(), "a.md".into()], &[]);
        assert_eq!(id1, id2);
    }
}
