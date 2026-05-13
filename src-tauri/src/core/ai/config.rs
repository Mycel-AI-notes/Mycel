use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

/// User-facing AI settings persisted at `.mycel/ai/config.json`.
///
/// Visible in git so a paranoid user can audit it. The API key is NOT here —
/// it lives in the OS keyring.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AiConfig {
    /// Master switch. When false, no AI commands talk to OpenRouter and the
    /// UI hides AI affordances. Default: false (opt-in).
    pub enabled: bool,
    /// Daily spending ceiling in USD. Once `ai_usage.cost_usd` for today
    /// crosses this, embedding requests fail with `BudgetExceeded` until the
    /// next local-midnight reset.
    pub daily_budget_usd: f64,
    /// Embedding model identifier passed to OpenRouter. Pinned to one option
    /// in MVP-1, but stored so future versions can switch without a migration.
    pub embedding_model: String,
}

impl Default for AiConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            daily_budget_usd: 1.0,
            embedding_model: "openai/text-embedding-3-small".to_string(),
        }
    }
}

fn config_path(vault_root: &Path) -> PathBuf {
    vault_root.join(".mycel").join("ai").join("config.json")
}

pub fn load(vault_root: &Path) -> Result<AiConfig> {
    let path = config_path(vault_root);
    if !path.exists() {
        return Ok(AiConfig::default());
    }
    let raw = std::fs::read_to_string(&path)
        .with_context(|| format!("Failed to read {}", path.display()))?;
    // Tolerant parsing: if the file is corrupt or from a future version with
    // unknown fields, fall back to defaults rather than wedging the vault.
    Ok(serde_json::from_str(&raw).unwrap_or_default())
}

pub fn save(vault_root: &Path, cfg: &AiConfig) -> Result<()> {
    let path = config_path(vault_root);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("Failed to create {}", parent.display()))?;
    }
    let json = serde_json::to_string_pretty(cfg)?;
    std::fs::write(&path, json)
        .with_context(|| format!("Failed to write {}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn load_returns_default_when_missing() {
        let dir = TempDir::new().unwrap();
        let cfg = load(dir.path()).unwrap();
        assert!(!cfg.enabled);
        assert_eq!(cfg.daily_budget_usd, 1.0);
    }

    #[test]
    fn round_trip() {
        let dir = TempDir::new().unwrap();
        let cfg = AiConfig {
            enabled: true,
            daily_budget_usd: 2.5,
            embedding_model: "openai/text-embedding-3-small".to_string(),
        };
        save(dir.path(), &cfg).unwrap();
        let loaded = load(dir.path()).unwrap();
        assert!(loaded.enabled);
        assert_eq!(loaded.daily_budget_usd, 2.5);
    }

    #[test]
    fn corrupt_file_falls_back_to_default() {
        let dir = TempDir::new().unwrap();
        let path = config_path(dir.path());
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(&path, "{{not json").unwrap();
        let cfg = load(dir.path()).unwrap();
        assert!(!cfg.enabled);
    }
}
