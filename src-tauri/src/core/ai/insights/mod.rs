//! Mycel Insights — daily inbox of "things you might want to look at".
//!
//! Phase 1 builds the *engine*: detector contract, store, scheduler, UI tab,
//! local telemetry. Zero real detectors ship here. Phase 2+ slots in
//! detectors one file at a time and the rest of the system doesn't change.
//!
//! See `README.md` in this directory for "how to add a detector".

pub mod detector;
pub mod detectors;
#[cfg(debug_assertions)]
pub mod mock_detector;
pub mod models;
pub mod scheduler;
pub mod settings;
pub mod store;

// Re-exports kept module-level so callers say `insights::Detector` instead of
// `insights::detector::Detector`. Phase 1 doesn't use every one externally,
// but they're the public surface Phase 2+ detectors will import.
#[allow(unused_imports)]
pub use detector::{signature, stable_id, Detector, DetectorContext};
#[allow(unused_imports)]
pub use models::{
    DetectorTelemetry, ExternalRef, Insight, InsightAction, InsightKind, InsightStatus,
    RunSummary, TelemetryReport,
};
pub use scheduler::InsightsEngine;
#[allow(unused_imports)]
pub use settings::{InsightsSettings, LimitSettings, ScheduleSettings};

/// Build the detector registry for this build.
///
/// Release builds ship with an empty registry — that's the explicit goal of
/// Phase 1. Debug builds get a single mock so developers can see the
/// pipeline produce a card without having to wait until Phase 2 ships.
pub fn default_detectors() -> Vec<Box<dyn Detector>> {
    let mut list: Vec<Box<dyn Detector>> = Vec::new();
    // Phase 2: the first real detector. Rides on the MVP-2 embedding index;
    // does nothing until the vault has been indexed.
    list.push(Box::new(detectors::similar_notes::SimilarNotesDetector));
    // Mock is off by default (see `MockDetector::enabled_by_default`) so even
    // in debug builds nothing happens until a developer flips it on.
    #[cfg(debug_assertions)]
    list.push(Box::new(mock_detector::MockDetector));
    list
}
