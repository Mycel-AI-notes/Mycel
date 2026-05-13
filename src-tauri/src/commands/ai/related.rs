//! Tauri command for the right-sidebar "Related" panel.
//!
//! Called every time the user opens or switches notes. Cheap — no
//! OpenRouter round-trip; just a centroid + kNN inside the local
//! sqlite-vec table. Returns `[]` when AI is off, no key, or the note
//! isn't indexed, so the UI can hide the section without ceremony.

use serde::Deserialize;
use tauri::State;

use super::{ensure_ai_state, err};
use crate::core::ai::related::{self, RelatedHit};
use crate::AppState;

#[derive(Debug, Deserialize)]
pub struct FindRelatedArgs {
    /// Vault-relative path of the source note, e.g. "Projects/garden.md".
    pub path: String,
    /// How many neighbors to return. Defaults to 5 (the right-sidebar
    /// list height); capped at 20 so a misuse from the command line
    /// can't blow up the response.
    pub k: Option<usize>,
}

#[tauri::command]
pub async fn ai_find_related(
    args: FindRelatedArgs,
    state: State<'_, AppState>,
) -> Result<Vec<RelatedHit>, String> {
    let ai = ensure_ai_state(&state).await?;
    let cfg = ai.config.lock().await.clone();
    if !cfg.enabled {
        // Don't return an error — the panel re-fetches on every note
        // switch, and an error-toast cascade for each tab change would
        // be hostile. Silent empty list lets the UI just not render.
        return Ok(Vec::new());
    }
    let k = args.k.unwrap_or(5).clamp(1, 20);
    related::find_related(&ai.store, &args.path, k).map_err(err)
}
