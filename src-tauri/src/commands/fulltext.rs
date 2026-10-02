//! Full-text search commands, plus the hooks other commands use to keep the
//! index current. The index itself lives in `core::fts`.

use std::path::Path;
use std::sync::Arc;

use crate::core::fts::{FtsIndex, SearchHit, SyncStats, DEFAULT_LIMIT};
use crate::AppState;
use tauri::State;

/// The open vault's index, opening it on first use — or when the cached one
/// belongs to a vault the user has since switched away from.
pub fn fts_index(state: &AppState, root: &Path) -> Result<Arc<FtsIndex>, String> {
    let mut guard = state
        .fts
        .lock()
        .map_err(|_| "Search index lock poisoned".to_string())?;
    if let Some(idx) = guard.as_ref() {
        if idx.root() == root {
            return Ok(idx.clone());
        }
    }
    let idx = Arc::new(FtsIndex::open(root).map_err(|e| format!("{e:#}"))?);
    *guard = Some(idx.clone());
    Ok(idx)
}

/// Reconcile `paths` after a command changed them on disk.
///
/// The watcher would get there too, but asynchronously: a search typed right
/// after a save, rename or delete would otherwise see the old state. Best
/// effort by design — the write already happened, and a stale index heals on
/// the next watcher event or session sync, so a failure here must not fail
/// the command that called it.
pub fn fts_touch(state: &AppState, root: &Path, paths: &[&str]) {
    let Ok(idx) = fts_index(state, root) else {
        return;
    };
    for p in paths {
        if let Err(e) = idx.update_path(p) {
            eprintln!("fts: failed to update {p}: {e:#}");
        }
    }
}

/// Remove `path` and compact, for a note that just became encrypted — its
/// plaintext must not outlive it in the index.
pub fn fts_purge(state: &AppState, root: &Path, path: &str) {
    if let Ok(idx) = fts_index(state, root) {
        if let Err(e) = idx.purge(path) {
            eprintln!("fts: failed to purge {path}: {e:#}");
        }
    }
}

/// Ask the next search to re-walk the vault (stamp-checked, so cheap) — for
/// edits spread over files the caller does not list, like link rewrites.
pub fn fts_invalidate(state: &AppState, root: &Path) {
    if let Ok(idx) = fts_index(state, root) {
        idx.invalidate();
    }
}

async fn vault_root(state: &State<'_, AppState>) -> Result<std::path::PathBuf, String> {
    let guard = state.vault.lock().await;
    guard
        .as_ref()
        .map(|v| v.root.clone())
        .ok_or_else(|| "No vault open".to_string())
}

/// Search note contents. See `core::fts::query` for the query language.
/// The first search of a session waits for the initial sync if the
/// background one started on vault open has not finished.
#[tauri::command]
pub async fn search_fulltext(
    query: String,
    limit: Option<usize>,
    state: State<'_, AppState>,
) -> Result<Vec<SearchHit>, String> {
    let root = vault_root(&state).await?;
    let idx = fts_index(&state, &root)?;
    // SQLite and the vault walk are blocking; keep them off the async
    // runtime so a big first sync does not stall other commands.
    tokio::task::spawn_blocking(move || {
        idx.ensure_synced()?;
        idx.search(&query, limit.unwrap_or(DEFAULT_LIMIT))
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("{e:#}"))
}

/// Drop the index and rebuild it from the files on disk.
#[tauri::command]
pub async fn search_reindex(state: State<'_, AppState>) -> Result<SyncStats, String> {
    let root = vault_root(&state).await?;
    let idx = fts_index(&state, &root)?;
    tokio::task::spawn_blocking(move || idx.rebuild())
        .await
        .map_err(|e| e.to_string())?
        .map_err(|e| format!("{e:#}"))
}
