use std::path::PathBuf;

use serde::Deserialize;
use tauri::State;

use crate::core::sync::{self, SyncConfig, SyncOutcome, SyncStatus};
use crate::core::sync_keyring;
use crate::AppState;

async fn vault_root(state: &State<'_, AppState>) -> Result<PathBuf, String> {
    let guard = state.vault.lock().await;
    guard
        .as_ref()
        .map(|v| v.root.clone())
        .ok_or_else(|| "No vault open".to_string())
}

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

#[derive(Debug, Deserialize)]
pub struct InitArgs {
    pub remote: String,
    pub branch: Option<String>,
    pub author_name: Option<String>,
    pub author_email: Option<String>,
    pub token: String,
}

#[tauri::command]
pub async fn sync_init(args: InitArgs, state: State<'_, AppState>) -> Result<(), String> {
    let root = vault_root(&state).await?;
    let branch = args.branch.unwrap_or_else(|| "main".to_string());
    let cfg = SyncConfig {
        remote: args.remote.clone(),
        branch: branch.clone(),
        author_name: args.author_name.unwrap_or_else(|| "Mycel User".into()),
        author_email: args.author_email.unwrap_or_else(|| "user@mycel.local".into()),
        auto_sync: true,
        debounce_ms: 30_000,
        last_sync_at: None,
    };
    sync_keyring::set_token(&root, &args.token).map_err(err)?;
    sync::write_config(&root, &cfg).map_err(err)?;
    sync::init(&root, &args.remote, &branch, &cfg, Some(&args.token)).map_err(err)?;
    Ok(())
}

#[derive(Debug, Deserialize)]
pub struct CloneArgs {
    pub remote: String,
    pub dest: String,
    pub branch: Option<String>,
    pub token: String,
}

#[tauri::command]
pub async fn sync_clone(args: CloneArgs) -> Result<String, String> {
    let dest = PathBuf::from(&args.dest);
    sync::clone(
        &args.remote,
        &dest,
        args.branch.as_deref(),
        Some(&args.token),
    )
    .map_err(err)?;

    // Persist token + sync.json so the freshly cloned vault is ready to sync.
    let cfg = SyncConfig {
        remote: args.remote.clone(),
        branch: args.branch.clone().unwrap_or_else(|| "main".into()),
        author_name: "Mycel User".into(),
        author_email: "user@mycel.local".into(),
        auto_sync: true,
        debounce_ms: 30_000,
        last_sync_at: None,
    };
    // Ensure .mycel exists (Vault::open will also create it, but we may write
    // sync.json before the user opens the vault).
    std::fs::create_dir_all(dest.join(".mycel")).map_err(err)?;
    sync::write_config(&dest, &cfg).map_err(err)?;
    sync_keyring::set_token(&dest, &args.token).map_err(err)?;

    Ok(dest.to_string_lossy().to_string())
}

#[tauri::command]
pub async fn sync_now(state: State<'_, AppState>) -> Result<SyncOutcome, String> {
    let root = vault_root(&state).await?;
    let cfg = sync::read_config(&root)
        .map_err(err)?
        .ok_or_else(|| "Sync is not configured for this vault".to_string())?;
    let token = sync_keyring::get_token(&root)
        .map_err(err)?
        .ok_or_else(|| "No GitHub token saved. Reconnect to enable sync.".to_string())?;
    sync::sync(&root, &cfg, Some(&token)).map_err(err)
}

#[tauri::command]
pub async fn sync_status(state: State<'_, AppState>) -> Result<SyncStatus, String> {
    let root = vault_root(&state).await?;
    sync::status(&root).map_err(err)
}

#[tauri::command]
pub async fn sync_get_config(state: State<'_, AppState>) -> Result<Option<SyncConfig>, String> {
    let root = vault_root(&state).await?;
    sync::read_config(&root).map_err(err)
}

#[tauri::command]
pub async fn sync_set_config(config: SyncConfig, state: State<'_, AppState>) -> Result<(), String> {
    let root = vault_root(&state).await?;
    sync::write_config(&root, &config).map_err(err)
}

#[tauri::command]
pub async fn sync_disable(state: State<'_, AppState>) -> Result<(), String> {
    let root = vault_root(&state).await?;
    sync_keyring::clear_token(&root).map_err(err)?;
    // Leave .git/ and sync.json in place — disable just revokes credentials.
    Ok(())
}

#[tauri::command]
pub async fn sync_set_token(token: String, state: State<'_, AppState>) -> Result<(), String> {
    let root = vault_root(&state).await?;
    sync_keyring::set_token(&root, &token).map_err(err)
}

#[tauri::command]
pub async fn sync_has_token(state: State<'_, AppState>) -> Result<bool, String> {
    let root = vault_root(&state).await?;
    Ok(sync_keyring::get_token(&root).map_err(err)?.is_some())
}

#[tauri::command]
pub async fn sync_clear_token(state: State<'_, AppState>) -> Result<(), String> {
    let root = vault_root(&state).await?;
    sync_keyring::clear_token(&root).map_err(err)
}
