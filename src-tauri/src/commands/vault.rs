use crate::core::vault::{FileEntry, Vault};
use crate::AppState;
use tauri::State;

#[tauri::command]
pub async fn vault_open(path: String, state: State<'_, AppState>) -> Result<Vec<FileEntry>, String> {
    let vault = Vault::open(&path).map_err(|e| e.to_string())?;
    let tree = vault.file_tree().map_err(|e| e.to_string())?;
    *state.vault.lock().await = Some(vault);
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
