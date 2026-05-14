//! Tauri command surface for the AI subsystem.
//!
//! Helpers shared between `settings`, `index`, and future search commands
//! live here so each command file stays small.

use std::path::PathBuf;
use std::sync::Arc;

use tauri::State;
use tokio::sync::Mutex;

use crate::core::ai::insights::{
    self as insights_mod, scheduler::run_catch_up_if_due, InsightsEngine,
};
use crate::core::ai::{config, store::AiStore, AiState};
use crate::AppState;

pub mod edges;
pub mod index;
pub mod insights;
pub mod related;
pub mod search;
pub mod settings;

pub(crate) fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

/// Like `err`, but uses anyhow's alternate Display ({:#}) to walk the full
/// `context()` chain. We use this on network paths where the top-level
/// message ("OpenRouter request failed") is useless without the underlying
/// cause (TLS error, DNS, HTTP 401, …).
pub(crate) fn err_chain(e: anyhow::Error) -> String {
    format!("{:#}", e)
}

pub(crate) async fn vault_root(state: &State<'_, AppState>) -> Result<PathBuf, String> {
    let guard = state.vault.lock().await;
    guard
        .as_ref()
        .map(|v| v.root.clone())
        .ok_or_else(|| "No vault open".to_string())
}

/// Lazily build (or fetch) the AI state for the open vault.
///
/// Single chokepoint where the SQLite handle gets opened on disk. The
/// Settings UI calls it on mount via `ai_get_status`, which materializes
/// `.mycel/ai/` the moment the dialog opens. Nothing reaches OpenRouter
/// until the user pastes a key and triggers a call.
pub(crate) async fn ensure_ai_state(
    state: &State<'_, AppState>,
) -> Result<Arc<AiState>, String> {
    let root = vault_root(state).await?;
    let mut guard = state.ai.lock().await;
    if let Some(existing) = guard.as_ref() {
        return Ok(existing.clone());
    }
    let cfg = config::load(&root).map_err(err)?;
    let store = Arc::new(AiStore::open(&root).map_err(err)?);
    // Materialize the four `insights_*` tables on first AI touch. Cheap —
    // each `CREATE TABLE IF NOT EXISTS` is a no-op once they exist.
    insights_mod::store::ensure_insights_schema(&store).map_err(err)?;

    let insights_settings = insights_mod::settings::load(&root).map_err(err)?;
    let engine = InsightsEngine::new(
        root.clone(),
        store.clone(),
        insights_settings,
        insights_mod::default_detectors(),
    );

    let new_state = Arc::new(AiState {
        config: Arc::new(Mutex::new(cfg)),
        store,
        indexing: Arc::new(Mutex::new(())),
        insights: engine.clone(),
    });
    *guard = Some(new_state.clone());

    // Catch up on a missed run if the user is past the scheduled time and
    // hasn't run yet today, then spawn the per-minute scheduler tick. Errors
    // are logged but don't block AI — a broken scheduler shouldn't take down
    // the whole AI surface.
    let engine_for_catch_up = engine.clone();
    tokio::spawn(async move {
        if let Err(e) = run_catch_up_if_due(&engine_for_catch_up).await {
            eprintln!("insights catch-up failed: {:#}", e);
        }
    });
    engine.spawn();

    Ok(new_state)
}
