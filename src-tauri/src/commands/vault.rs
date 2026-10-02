use crate::core::vault::{FileEntry, Vault};
use crate::core::watcher::start_watcher;
use crate::AppState;
use tauri::{AppHandle, State};

#[tauri::command]
pub async fn vault_open(
    path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<FileEntry>, String> {
    let vault = Vault::open(&path).map_err(|e| e.to_string())?;
    let tree = vault.file_tree().map_err(|e| e.to_string())?;
    let root = vault.root.clone();
    *state.vault.lock().await = Some(vault);

    // Switching vaults must drop any X25519 key material we hold for the
    // previous vault — keys are per-vault.
    state.crypto.lock();

    // Same reasoning for AI state: the SQLite handle and the loaded config
    // belong to the previous vault. Clearing forces lazy re-init against the
    // new vault's `.mycel/ai/`.
    *state.ai.lock().await = None;

    // Full-text index: open it now so the watcher can keep it fresh, and
    // catch up on whatever changed while Mycel was closed in the background
    // — the walk is stamp-checked, but a first build on a large vault still
    // takes a moment the vault-open path should not wait for. A search
    // issued before it finishes simply runs its own (serialized) sync.
    let fts = match crate::commands::fulltext::fts_index(&state, &root) {
        Ok(idx) => {
            let bg = idx.clone();
            tokio::task::spawn_blocking(move || {
                if let Err(e) = bg.sync() {
                    eprintln!("fts: initial sync failed: {e:#}");
                }
            });
            Some(idx)
        }
        Err(e) => {
            eprintln!("fts: failed to open index: {e}");
            None
        }
    };

    let new_watcher = start_watcher(app, root, fts);
    *state.watcher.lock().await = new_watcher;

    Ok(tree)
}

#[tauri::command]
pub async fn vault_get_tree(state: State<'_, AppState>) -> Result<Vec<FileEntry>, String> {
    let guard = state.vault.lock().await;
    match guard.as_ref() {
        Some(vault) => vault.file_tree().map_err(|e| e.to_string()),
        None => Err("No vault open".into()),
    }
}

#[tauri::command]
pub async fn vault_root(state: State<'_, AppState>) -> Result<Option<String>, String> {
    let guard = state.vault.lock().await;
    Ok(guard.as_ref().map(|v| v.root.to_string_lossy().to_string()))
}
