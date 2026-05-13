//! Tauri commands powering the graph view's "Semantic" toggle.
//!
//! `ai_recompute_edges` is the expensive one — O(N²) cosine sims — and
//! emits `ai-edges-progress` so the UI can render a "computing edges…"
//! bar. `ai_list_semantic_edges` is the cheap slider-driven query: an
//! indexed range scan over the already-materialized `semantic_edges`
//! table.

use serde::Deserialize;
use tauri::{AppHandle, Emitter, State};

use super::{ensure_ai_state, err, vault_root};
use crate::core::ai::edges::{
    self, EdgesStatus, EdgesSummary, RecomputeProgress, SemanticEdge,
};
use crate::AppState;

const PROGRESS_EVENT: &str = "ai-edges-progress";

#[tauri::command]
pub async fn ai_edges_status(state: State<'_, AppState>) -> Result<EdgesStatus, String> {
    let ai = ensure_ai_state(&state).await?;
    edges::status(&ai.store).map_err(err)
}

#[tauri::command]
pub async fn ai_recompute_edges(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<EdgesSummary, String> {
    let _root = vault_root(&state).await?;
    let ai = ensure_ai_state(&state).await?;

    // Reuse the indexing lock — pairwise-recompute and a bulk reindex
    // both touch tables the other reads, and overlapping them would
    // produce inconsistent edges (some pairs from old centroids, some
    // from new). `try_lock` so the UI gets a clean "already running"
    // response instead of hanging.
    let _guard = ai
        .indexing
        .try_lock()
        .map_err(|_| "An indexing job is already running".to_string())?;

    // Clone the parts the blocking task needs so the parent `ai` Arc
    // (and the lock guard) can stay alive on this stack until the task
    // joins. The store handle is Arc-internal so this is a refcount
    // bump, not a deep clone.
    let store = ai.store.clone();
    let emit_handle = app.clone();
    let summary = tokio::task::spawn_blocking(move || {
        edges::recompute(&store, move |p: RecomputeProgress| {
            // Drop emit errors silently — a missed progress tick is a
            // cosmetic issue, the final summary still reconciles the UI.
            let _ = emit_handle.emit(PROGRESS_EVENT, &p);
        })
    })
    .await
    .map_err(|e| format!("edge recompute task crashed: {e}"))?
    .map_err(err)?;

    Ok(summary)
}

#[derive(Debug, Deserialize)]
pub struct ListEdgesArgs {
    pub threshold: f32,
}

#[tauri::command]
pub async fn ai_list_semantic_edges(
    args: ListEdgesArgs,
    state: State<'_, AppState>,
) -> Result<Vec<SemanticEdge>, String> {
    let ai = ensure_ai_state(&state).await?;
    let cfg = ai.config.lock().await.clone();
    if !cfg.enabled {
        // Same pattern as `ai_find_related`: silent empty list when AI
        // is off, so the toggle can be flipped without an error toast.
        return Ok(Vec::new());
    }
    // Clamp to the UI slider's range so a degenerate caller can't ask
    // for a meaningless negative threshold and get every row in the
    // table (or above 1.0 and get nothing surprising).
    let threshold = args.threshold.clamp(0.0, 1.0);
    edges::list(&ai.store, threshold).map_err(err)
}
