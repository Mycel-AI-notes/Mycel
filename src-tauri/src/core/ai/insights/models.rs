//! Wire types shared between the detector trait, the SQLite store, and the
//! Tauri commands that the UI invokes.
//!
//! These are intentionally serde-friendly: the same `Insight` rendered by the
//! `Detector::run` author also lands in `insights.body` on disk and lands in
//! the React inbox after a Tauri call. Keeping one struct end-to-end means
//! the contract has exactly one source of truth.

use serde::{Deserialize, Serialize};

/// One actionable card in the Insights inbox.
///
/// `id` is a stable hash over (kind + sorted note_paths + key fields) so a
/// detector that re-discovers the same finding on the next run produces an
/// identical id. Combined with the cooldown table this is what makes
/// "dismissed yesterday → not shown today" work.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Insight {
    pub id: String,
    pub kind: InsightKind,
    pub confidence: f32,
    pub title: String,
    pub body: String,
    pub note_paths: Vec<String>,
    pub actions: Vec<InsightAction>,
    #[serde(default)]
    pub external_refs: Vec<ExternalRef>,
    pub generated_at: i64,
}

/// Catalog of every detector type the engine ships or might ship.
///
/// Phase 1 ships zero real detectors — the variants below are pre-declared so
/// later phases can land in one file each without growing this enum.
/// `#[serde(rename_all = "snake_case")]` keeps the on-disk and over-the-wire
/// names stable even if we rename the variants on the Rust side.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InsightKind {
    MissingWikilink,
    BridgeCandidate,
    Resurfacing,
    TodayCompanion,
    QuestionAnswered,
    NewsForTheme,
    Echo,
    StrandedNote,
    EmergingTheme,
    ProblemResearched,
    IdeaStateOfArt,
}

impl InsightKind {
    /// Stable string used for SQLite keys, detector telemetry, and the
    /// settings-toggle dict. Matches the serde rename above.
    pub fn as_key(&self) -> &'static str {
        match self {
            InsightKind::MissingWikilink => "missing_wikilink",
            InsightKind::BridgeCandidate => "bridge_candidate",
            InsightKind::Resurfacing => "resurfacing",
            InsightKind::TodayCompanion => "today_companion",
            InsightKind::QuestionAnswered => "question_answered",
            InsightKind::NewsForTheme => "news_for_theme",
            InsightKind::Echo => "echo",
            InsightKind::StrandedNote => "stranded_note",
            InsightKind::EmergingTheme => "emerging_theme",
            InsightKind::ProblemResearched => "problem_researched",
            InsightKind::IdeaStateOfArt => "idea_state_of_art",
        }
    }
}

/// Button choices rendered on a card.
///
/// `Dismiss` is omitted on purpose: every card gets a Dismiss button injected
/// by the UI, and detectors should not be able to influence that surface.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum InsightAction {
    OpenNote {
        note_path: String,
    },
    OpenSideBySide {
        note_paths: Vec<String>,
    },
    /// Suggests writing `[[target]]` into `source`. The UI MUST confirm before
    /// the write actually lands — Phase 1 does not perform the write, it only
    /// shows the suggestion.
    InsertWikilink {
        source: String,
        target: String,
    },
    CreateNoteFromTemplate {
        template_id: String,
        suggested_path: String,
    },
    OpenExternal {
        url: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExternalRef {
    pub url: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snippet: Option<String>,
}

/// Lifecycle of one row in `insights`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InsightStatus {
    Pending,
    Acted,
    Dismissed,
}

impl InsightStatus {
    pub fn as_str(&self) -> &'static str {
        match self {
            InsightStatus::Pending => "pending",
            InsightStatus::Acted => "acted",
            InsightStatus::Dismissed => "dismissed",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        match s {
            "pending" => Some(InsightStatus::Pending),
            "acted" => Some(InsightStatus::Acted),
            "dismissed" => Some(InsightStatus::Dismissed),
            _ => None,
        }
    }
}

/// Summary of one scheduler invocation. Returned by `insights_run_now` so the
/// UI can toast "Found N insights in Xs".
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RunSummary {
    pub started_at: i64,
    pub finished_at: i64,
    pub detectors_run: usize,
    pub insights_generated: usize,
    pub errors: Vec<String>,
}

/// One row of the acceptance report: how often the user acts on what a given
/// detector produces. `rate = acted / shown` is computed on the frontend so
/// we can render "—" for shown == 0 without doing it in SQL.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DetectorTelemetry {
    pub detector_name: String,
    pub shown: u32,
    pub acted: u32,
    pub dismissed: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TelemetryReport {
    pub days: u32,
    pub rows: Vec<DetectorTelemetry>,
}
