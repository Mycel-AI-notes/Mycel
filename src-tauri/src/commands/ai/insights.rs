//! Tauri commands for the Insights inbox UI.
//!
//! Same error convention as the rest of the AI surface: return `String` so
//! the frontend's `invoke` rejection has a single readable line.

use serde::Serialize;
use tauri::State;

use crate::core::ai::insights::models::{
    Insight, InsightStatus, RunSummary, TelemetryReport,
};
use crate::core::ai::insights::{settings as isettings, store as istore, InsightsSettings};
use crate::AppState;

use super::{ensure_ai_state, err, vault_root};

#[tauri::command]
pub async fn insights_list(
    status: Option<String>,
    limit: Option<i64>,
    state: State<'_, AppState>,
) -> Result<Vec<Insight>, String> {
    let ai = ensure_ai_state(&state).await?;
    let parsed = status.as_deref().and_then(InsightStatus::parse);
    let lim = limit.unwrap_or(100);
    istore::list_insights(&ai.store, parsed, lim).map_err(err)
}

#[tauri::command]
pub async fn insights_run_now(state: State<'_, AppState>) -> Result<RunSummary, String> {
    let ai = ensure_ai_state(&state).await?;
    // Manual triggers ignore the enabled flag's "scheduled run" gating, but
    // we still honor the master toggle — clicking "Run now" while the engine
    // is OFF should be a no-op rather than a surprise.
    let settings = ai.insights.settings.lock().await.clone();
    if !settings.enabled {
        return Err("Insights are disabled. Enable them in Settings first.".into());
    }
    ai.insights.run_once(&settings).await.map_err(err)
}

#[tauri::command]
pub async fn insights_dismiss(
    insight_id: String,
    cooldown_days: Option<u32>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let ai = ensure_ai_state(&state).await?;
    let configured = ai
        .insights
        .settings
        .lock()
        .await
        .limits
        .default_cooldown_days as i64;
    let final_days = cooldown_days.map(|d| d as i64).unwrap_or(configured);
    let now = chrono::Utc::now().timestamp();
    istore::dismiss_with_cooldown(&ai.store, &insight_id, final_days, now).map_err(err)?;

    // Telemetry is keyed by the kind on the dismissed row so the acceptance
    // report can aggregate "dismissed" per detector even though dismiss
    // itself doesn't know which detector originally produced this card.
    let detector = istore::detector_of(&ai.store, &insight_id).map_err(err)?;
    if let Some(d) = detector.filter(|s| !s.is_empty()) {
        istore::log_telemetry(&ai.store, &d, "dismissed", &insight_id, now).map_err(err)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn insights_act(
    insight_id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let ai = ensure_ai_state(&state).await?;
    istore::mark_acted(&ai.store, &insight_id).map_err(err)?;
    let now = chrono::Utc::now().timestamp();
    let detector = istore::detector_of(&ai.store, &insight_id).map_err(err)?;
    if let Some(d) = detector.filter(|s| !s.is_empty()) {
        istore::log_telemetry(&ai.store, &d, "acted", &insight_id, now).map_err(err)?;
    }
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct InsightsStatus {
    pub settings: InsightsSettings,
    pub pending_count: usize,
    pub last_run_at: Option<i64>,
}

#[tauri::command]
pub async fn insights_settings_get(
    state: State<'_, AppState>,
) -> Result<InsightsStatus, String> {
    let ai = ensure_ai_state(&state).await?;
    let settings = ai.insights.settings.lock().await.clone();
    let pending =
        istore::list_insights(&ai.store, Some(InsightStatus::Pending), 1000).map_err(err)?;
    let last = istore::last_successful_run_at(&ai.store).map_err(err)?;
    Ok(InsightsStatus {
        settings,
        pending_count: pending.len(),
        last_run_at: last,
    })
}

#[tauri::command]
pub async fn insights_settings_set(
    settings: InsightsSettings,
    state: State<'_, AppState>,
) -> Result<InsightsStatus, String> {
    let root = vault_root(&state).await?;
    let ai = ensure_ai_state(&state).await?;
    isettings::save(&root, &settings).map_err(err)?;
    *ai.insights.settings.lock().await = settings;
    insights_settings_get(state).await
}

#[tauri::command]
pub async fn insights_telemetry_report(
    days: Option<u32>,
    state: State<'_, AppState>,
) -> Result<TelemetryReport, String> {
    let ai = ensure_ai_state(&state).await?;
    let d = days.unwrap_or(30);
    let now = chrono::Utc::now().timestamp();
    istore::telemetry_report(&ai.store, d, now).map_err(err)
}
