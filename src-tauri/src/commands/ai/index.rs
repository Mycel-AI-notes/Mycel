//! Tauri commands that drive the indexer.
//!
//! All three commands require AI to be enabled AND a key to be stored.
//! That's stricter than the settings commands (which need only a vault)
//! because every indexer call could spend money — making it easy to
//! kick off accidentally would defeat the whole "default-off" stance.

use serde::Deserialize;
use tauri::{AppHandle, Emitter, State};

use super::{ensure_ai_state, err, err_chain, vault_root};
use crate::core::ai::{
    embedder::OpenRouterEmbedder,
    indexer::{self, BulkProgress, BulkSummary, IndexOutcome, IndexStatus},
    keyring,
};
use crate::AppState;

const PROGRESS_EVENT: &str = "ai-index-progress";

#[tauri::command]
pub async fn ai_index_status(state: State<'_, AppState>) -> Result<IndexStatus, String> {
    let ai = ensure_ai_state(&state).await?;
    indexer::status(&ai.store).map_err(err)
}

#[tauri::command]
pub async fn ai_index_bulk(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<BulkSummary, String> {
    let (ai, root, key, cfg) = bootstrap(&state).await?;

    // Serialize bulk runs and concurrent single-note indexes. `try_lock`
    // gives a clean error if a previous run is still active, so the UI
    // can render "already running" instead of stacking up.
    let _guard = ai
        .indexing
        .try_lock()
        .map_err(|_| "An indexing job is already running".to_string())?;

    let embedder = OpenRouterEmbedder::new(key, cfg.embedding_model.clone());

    // Tauri's `Emitter::emit` is sync and Send-safe, but we still clone
    // the AppHandle into the closure so the borrow stays purely local.
    let emit_handle = app.clone();
    let summary = indexer::bulk_reindex(
        &ai.store,
        &embedder,
        &root,
        cfg.daily_budget_usd,
        &cfg.embedding_model,
        move |p: BulkProgress| {
            // We deliberately ignore emit errors: a failed event delivery
            // doesn't make the index any less valid, and the next event
            // (or the final summary) will reconcile the UI.
            let _ = emit_handle.emit(PROGRESS_EVENT, &p);
        },
    )
    .await
    .map_err(err_chain)?;

    Ok(summary)
}

#[derive(Debug, Deserialize)]
pub struct IndexNoteArgs {
    /// Path relative to the vault root, e.g. "Projects/garden.md".
    pub path: String,
}

#[tauri::command]
pub async fn ai_index_note(
    args: IndexNoteArgs,
    state: State<'_, AppState>,
) -> Result<IndexOutcome, String> {
    let (ai, root, key, cfg) = bootstrap(&state).await?;
    let _guard = ai.indexing.lock().await;
    let embedder = OpenRouterEmbedder::new(key, cfg.embedding_model.clone());
    indexer::index_note(
        &ai.store,
        &embedder,
        &root,
        &args.path,
        cfg.daily_budget_usd,
        &cfg.embedding_model,
    )
    .await
    .map_err(err_chain)
}

// ---- helpers ------------------------------------------------------------

/// Pull every piece an indexer command needs in one go. Centralizing the
/// "is AI usable" guard here keeps each command body small and the rules
/// uniform: if any of (vault open, AI enabled, key saved) fails, no
/// command runs.
async fn bootstrap(
    state: &State<'_, AppState>,
) -> Result<
    (
        std::sync::Arc<crate::core::ai::AiState>,
        std::path::PathBuf,
        String,
        crate::core::ai::config::AiConfig,
    ),
    String,
> {
    let root = vault_root(state).await?;
    let ai = ensure_ai_state(state).await?;
    let cfg = ai.config.lock().await.clone();
    if !cfg.enabled {
        return Err("AI is disabled; enable it in Settings first".into());
    }
    let key = keyring::get_key(&root)
        .map_err(err)?
        .ok_or_else(|| "No OpenRouter API key saved".to_string())?;
    Ok((ai, root, key, cfg))
}
