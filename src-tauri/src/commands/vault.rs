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

    let new_watcher = start_watcher(app, root);
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
