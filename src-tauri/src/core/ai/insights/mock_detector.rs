//! Debug-only mock detector.
//!
//! The scheduler, store, and UI ship in Phase 1 with zero real detectors.
//! That's by design — Phase 1's whole job is to nail the contract before any
//! detector is written. But to actually see the pipeline work end-to-end
//! (and so the UI has something to render during development) we register a
//! single mock under `#[cfg(debug_assertions)]`. It's compiled out of
//! release builds entirely.

use async_trait::async_trait;

use super::detector::{stable_id, Detector, DetectorContext};
use super::models::{Insight, InsightAction, InsightKind};

pub struct MockDetector;

#[async_trait]
impl Detector for MockDetector {
    fn name(&self) -> &'static str {
        "_mock"
    }

    fn enabled_by_default(&self) -> bool {
        // Even in debug builds, off by default in settings — flip it
        // manually when you want a card to appear.
        false
    }

    async fn run(&self, _ctx: &DetectorContext<'_>) -> anyhow::Result<Vec<Insight>> {
        let paths = vec!["mock/example.md".to_string()];
        let id = stable_id(InsightKind::MissingWikilink.as_key(), &paths, &["mock"]);
        Ok(vec![Insight {
            id,
            kind: InsightKind::MissingWikilink,
            confidence: 0.5,
            title: "Mock insight".into(),
            body: "This is a debug-only insight to verify the pipeline. \
                   It won't appear in release builds."
                .into(),
            note_paths: paths.clone(),
            actions: vec![InsightAction::OpenNote {
                note_path: paths[0].clone(),
            }],
            external_refs: vec![],
            generated_at: chrono::Utc::now().timestamp(),
        }])
    }
}
