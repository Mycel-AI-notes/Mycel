//! Tauri command surface for semantic search.
//!
//! The frontend Quick Switcher calls this in parallel with the existing
//! keyword search and merges the two ranked lists via Reciprocal Rank
//! Fusion (`src/lib/rrf.ts`). Keeping the merge on the frontend avoids
//! piping the keyword list through Rust just to combine it; the keyword
//! search is already a pure JS function over `notes_list`.

use serde::Deserialize;
use tauri::State;

use super::{ensure_ai_state, err_chain, vault_root};
use crate::core::ai::{
    embedder::OpenRouterEmbedder,
    keyring,
    search::{self, SemanticHit},
};
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct SemanticSearchArgs {
    pub query: String,
    /// How many *notes* the caller wants back. The implementation pulls a
    /// larger raw chunk window internally so dedupe-by-note still
    /// produces `k` results.
    pub k: Option<usize>,
}

#[tauri::command]
pub async fn ai_semantic_search(
    args: SemanticSearchArgs,
    state: State<'_, AppState>,
) -> Result<Vec<SemanticHit>, String> {
    let _root = vault_root(&state).await?;
    let ai = ensure_ai_state(&state).await?;
    let cfg = ai.config.lock().await.clone();

    // We don't error out when AI is disabled or no key is set; we just
    // return an empty list so the Quick Switcher falls back to keyword-
    // only behavior cleanly. The same call site can render with or
    // without semantic results.
    if !cfg.enabled {
        return Ok(Vec::new());
    }
    let vault = vault_root(&state).await?;
    let key = match keyring::get_key(&vault).map_err(|e| e.to_string())? {
        Some(k) => k,
        None => return Ok(Vec::new()),
    };

    let k = args.k.unwrap_or(20).clamp(1, 50);
    let embedder = OpenRouterEmbedder::new(key, cfg.embedding_model.clone());
    search::semantic_search(
        &ai.store,
        &embedder,
        &args.query,
        k,
        cfg.daily_budget_usd,
        &cfg.embedding_model,
    )
    .await
    .map_err(err_chain)
}
