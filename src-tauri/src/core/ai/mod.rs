//! Mycel AI: local semantic layer over the vault.
//!
//! MVP-1 is read-only — we never write to `.md` files. Everything lives under
//! `.mycel/ai/`:
//!   - `config.json`     user-tunable knobs (enabled flag, budget, model)
//!   - `insights.json`   Phase 1 — daily inbox settings, schedule, limits
//!   - `index.db`        SQLite. `ai_usage` plus the four `insights_*` tables.
//!
//! The OpenRouter API key lives in the OS keyring (same pattern as the sync
//! PAT), never in a file.

// Several items here are unused in MVP-1 by design — the embedding pipeline
// in MVP-2 is what consumes `budget::check`, `openrouter::test_key`, and the
// embedding-result fields. Marking the module-level allow keeps the build
// warning-free without scattering attributes on each future-facing item.
#![allow(dead_code)]

pub mod budget;
pub mod config;
pub mod insights;
pub mod keyring;
pub mod openrouter;
pub mod store;

use std::sync::Arc;
use tokio::sync::Mutex;

use config::AiConfig;
use insights::InsightsEngine;
use store::AiStore;

/// Per-vault AI state held in `AppState::ai`. `None` until a vault is open
/// (or the vault doesn't have AI initialized yet).
pub struct AiState {
    pub config: Arc<Mutex<AiConfig>>,
    pub store: Arc<AiStore>,
    /// Phase 1 Insights engine. Materialized alongside the SQLite store —
    /// the per-minute tick is already running by the time any UI command
    /// arrives, so "Run now" and the scheduled run share one engine.
    pub insights: InsightsEngine,
}
