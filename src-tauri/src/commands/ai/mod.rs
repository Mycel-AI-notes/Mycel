//! Tauri command surface for the AI subsystem.
//!
//! Helpers shared between `settings`, `index`, and future search commands
//! live here so each command file stays small.

use std::path::PathBuf;
use std::sync::Arc;

use tauri::State;
use tokio::sync::Mutex;

use crate::core::ai::{config, store::AiStore, AiState};
use crate::AppState;

pub mod index;
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
    let store = AiStore::open(&root).map_err(err)?;
    let new_state = Arc::new(AiState {
        config: Arc::new(Mutex::new(cfg)),
        store: Arc::new(store),
        indexing: Arc::new(Mutex::new(())),
    });
    *guard = Some(new_state.clone());
    Ok(new_state)
}
