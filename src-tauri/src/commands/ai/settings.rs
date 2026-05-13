//! Tauri commands for the AI Settings panel.
//!
//! All commands require a vault to be open (so we know where to store config
//! and which keyring entry to use). Returning errors as `String` matches the
//! existing convention used by `commands::sync`.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::core::ai::{budget, config, keyring, openrouter, store::AiStore, AiState};
use crate::AppState;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

async fn vault_root(state: &State<'_, AppState>) -> Result<PathBuf, String> {
    let guard = state.vault.lock().await;
    guard
        .as_ref()
        .map(|v| v.root.clone())
        .ok_or_else(|| "No vault open".to_string())
}

/// Lazily build (or fetch) the AI state for the open vault.
///
/// This is the single chokepoint where the SQLite handle gets opened on
/// disk. Settings UI calls it on mount via `ai_get_status`, which means a
/// fresh vault gets `.mycel/ai/` materialized the moment the user opens
/// Settings — but nothing is written to OpenRouter until the user pastes a
/// key and clicks Test.
async fn ensure_ai_state(state: &State<'_, AppState>) -> Result<std::sync::Arc<AiState>, String> {
    let root = vault_root(state).await?;
    let mut guard = state.ai.lock().await;
    if let Some(existing) = guard.as_ref() {
        return Ok(existing.clone());
    }
    let cfg = config::load(&root).map_err(err)?;
    let store = AiStore::open(&root).map_err(err)?;
    let new_state = std::sync::Arc::new(AiState {
        config: std::sync::Arc::new(tokio::sync::Mutex::new(cfg)),
        store: std::sync::Arc::new(store),
    });
    *guard = Some(new_state.clone());
    Ok(new_state)
}

#[derive(Debug, Serialize)]
pub struct AiStatus {
    pub enabled: bool,
    pub has_key: bool,
    pub daily_budget_usd: f64,
    pub embedding_model: String,
    pub usage_today: budget::DailyUsage,
}

#[tauri::command]
pub async fn ai_get_status(state: State<'_, AppState>) -> Result<AiStatus, String> {
    let root = vault_root(&state).await?;
    let ai = ensure_ai_state(&state).await?;
    let cfg = ai.config.lock().await.clone();
    let has_key = keyring::get_key(&root).map_err(err)?.is_some();
    let usage_today = budget::today_usage(&ai.store).map_err(err)?;
    Ok(AiStatus {
        enabled: cfg.enabled,
        has_key,
        daily_budget_usd: cfg.daily_budget_usd,
        embedding_model: cfg.embedding_model,
        usage_today,
    })
}

#[derive(Debug, Deserialize)]
pub struct UpdateConfigArgs {
    pub enabled: Option<bool>,
    pub daily_budget_usd: Option<f64>,
    pub embedding_model: Option<String>,
}

#[tauri::command]
pub async fn ai_update_config(
    args: UpdateConfigArgs,
    state: State<'_, AppState>,
) -> Result<AiStatus, String> {
    let root = vault_root(&state).await?;
    let ai = ensure_ai_state(&state).await?;
    {
        let mut cfg = ai.config.lock().await;
        if let Some(e) = args.enabled {
            cfg.enabled = e;
        }
        if let Some(b) = args.daily_budget_usd {
            // Negative budgets are nonsense; clamp at 0 so the UI can't write
            // a value that would make `check()` reject every request silently.
            cfg.daily_budget_usd = b.max(0.0);
        }
        if let Some(m) = args.embedding_model {
            cfg.embedding_model = m;
        }
        config::save(&root, &cfg).map_err(err)?;
    }
    // Drop the lock before fanning back through ai_get_status (which re-locks).
    ai_get_status(state).await
}

#[derive(Debug, Deserialize)]
pub struct SetKeyArgs {
    pub key: String,
}

#[tauri::command]
pub async fn ai_set_key(args: SetKeyArgs, state: State<'_, AppState>) -> Result<(), String> {
    let root = vault_root(&state).await?;
    let trimmed = args.key.trim();
    if trimmed.is_empty() {
        return Err("API key is empty".into());
    }
    keyring::set_key(&root, trimmed).map_err(err)
}

#[tauri::command]
pub async fn ai_clear_key(state: State<'_, AppState>) -> Result<(), String> {
    let root = vault_root(&state).await?;
    keyring::clear_key(&root).map_err(err)
}

#[derive(Debug, Serialize)]
pub struct TestKeyResult {
    pub ok: bool,
    pub model: String,
}

/// Live round-trip against OpenRouter. Burns a single token, then records
/// the usage so the user sees the budget counter tick — that doubles as a
/// signal that the budget pipeline is wired end-to-end.
#[tauri::command]
pub async fn ai_test_key(state: State<'_, AppState>) -> Result<TestKeyResult, String> {
    let root = vault_root(&state).await?;
    let ai = ensure_ai_state(&state).await?;
    let key = keyring::get_key(&root)
        .map_err(err)?
        .ok_or_else(|| "No OpenRouter API key saved".to_string())?;
    let model = ai.config.lock().await.embedding_model.clone();

    let client = openrouter::OpenRouterClient::new();
    let resp = client
        .embed(&key, &model, &["ping".to_string()])
        .await
        .map_err(err)?;

    // Record actual tokens reported by the response. Cost is unknown at this
    // layer (OpenRouter doesn't return USD), so we charge a flat penny — the
    // exact pricing table comes in MVP-2 when we batch real chunks.
    budget::record(
        &ai.store,
        &model,
        resp.usage.prompt_tokens,
        0,
        0.0,
    )
    .map_err(err)?;

    Ok(TestKeyResult {
        ok: true,
        model: if resp.model.is_empty() { model } else { resp.model },
    })
}

