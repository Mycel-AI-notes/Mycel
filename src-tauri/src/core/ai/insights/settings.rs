//! User-facing knobs for the Insights engine.
//!
//! Stored at `.mycel/ai/insights.json`. Kept in its own file (rather than
//! folded into `ai/config.json`) because the schema will grow with each
//! detector — having a separate file means a bad merge or a future-version
//! schema can't take the API-key / budget config down with it.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};

use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ScheduleSettings {
    /// 24h `HH:MM`. Validated on save; corrupt values fall back to default.
    pub time: String,
    pub catch_up: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct LimitSettings {
    pub max_per_day: u32,
    pub max_per_kind: u32,
    pub default_cooldown_days: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct InsightsSettings {
    /// Master switch. When `false`:
    ///   - the scheduler tick is a no-op,
    ///   - the right-panel tab is hidden in the UI,
    ///   - no rows are ever written to the insights tables.
    pub enabled: bool,
    pub schedule: ScheduleSettings,
    pub limits: LimitSettings,
    /// detector_name -> enabled. Empty by default; a detector not listed
    /// here falls back to its `enabled_by_default()`.
    #[serde(default)]
    pub detectors: BTreeMap<String, bool>,
    /// Minimum semantic similarity (0-100%) for the `similar_notes`
    /// detector to surface a note pair. Higher = stricter / fewer cards.
    #[serde(default = "default_min_similarity")]
    pub similar_notes_min_similarity: u32,
    /// At or above this similarity (0-100%) a pair is treated as a
    /// *duplicate* — the card offers "Resolve duplicate" instead of
    /// "Insert link".
    #[serde(default = "default_duplicate_similarity")]
    pub similar_notes_duplicate_similarity: u32,
    /// Notes shorter than this many words are ignored by `similar_notes`
    /// entirely. Short stubs (a title and a line or two) produce noisy,
    /// unreliable matches, so we skip any pair that touches one.
    #[serde(default = "default_min_words")]
    pub similar_notes_min_words: u32,
}

fn default_min_similarity() -> u32 {
    70
}

fn default_duplicate_similarity() -> u32 {
    95
}

fn default_min_words() -> u32 {
    100
}

impl Default for InsightsSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            schedule: ScheduleSettings {
                time: "07:00".into(),
                catch_up: true,
            },
            limits: LimitSettings {
                max_per_day: 10,
                max_per_kind: 3,
                default_cooldown_days: 14,
            },
            detectors: BTreeMap::new(),
            similar_notes_min_similarity: default_min_similarity(),
            similar_notes_duplicate_similarity: default_duplicate_similarity(),
            similar_notes_min_words: default_min_words(),
        }
    }
}

impl InsightsSettings {
    /// Returns `(hour, minute)` parsed from `schedule.time`. Falls back to
    /// 07:00 if the stored value is malformed — the engine treats schedule
    /// as best-effort, never as a place to crash.
    pub fn schedule_hm(&self) -> (u32, u32) {
        parse_hm(&self.schedule.time).unwrap_or((7, 0))
    }
}

fn parse_hm(s: &str) -> Option<(u32, u32)> {
    let mut parts = s.splitn(2, ':');
    let h: u32 = parts.next()?.parse().ok()?;
    let m: u32 = parts.next()?.parse().ok()?;
    if h < 24 && m < 60 {
        Some((h, m))
    } else {
        None
    }
}

fn settings_path(vault_root: &Path) -> PathBuf {
    vault_root.join(".mycel").join("ai").join("insights.json")
}

pub fn load(vault_root: &Path) -> Result<InsightsSettings> {
    let path = settings_path(vault_root);
    if !path.exists() {
        return Ok(InsightsSettings::default());
    }
    let raw = std::fs::read_to_string(&path)
        .with_context(|| format!("Failed to read {}", path.display()))?;
    Ok(serde_json::from_str(&raw).unwrap_or_default())
}

pub fn save(vault_root: &Path, s: &InsightsSettings) -> Result<()> {
    let path = settings_path(vault_root);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .with_context(|| format!("Failed to create {}", parent.display()))?;
    }
    let json = serde_json::to_string_pretty(s)?;
    std::fs::write(&path, json)
        .with_context(|| format!("Failed to write {}", path.display()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn default_is_off() {
        let s = InsightsSettings::default();
        assert!(!s.enabled);
        assert_eq!(s.schedule.time, "07:00");
        assert_eq!(s.limits.max_per_day, 10);
    }

    #[test]
    fn round_trip() {
        let dir = TempDir::new().unwrap();
        let mut s = InsightsSettings::default();
        s.enabled = true;
        s.schedule.time = "09:30".into();
        s.detectors.insert("missing_wikilink".into(), false);
        save(dir.path(), &s).unwrap();
        let loaded = load(dir.path()).unwrap();
        assert!(loaded.enabled);
        assert_eq!(loaded.schedule.time, "09:30");
        assert_eq!(loaded.detectors.get("missing_wikilink"), Some(&false));
    }

    #[test]
    fn schedule_hm_parses_and_falls_back() {
        let mut s = InsightsSettings::default();
        s.schedule.time = "08:42".into();
        assert_eq!(s.schedule_hm(), (8, 42));
        s.schedule.time = "garbage".into();
        assert_eq!(s.schedule_hm(), (7, 0));
        s.schedule.time = "25:00".into();
        assert_eq!(s.schedule_hm(), (7, 0));
    }

}
