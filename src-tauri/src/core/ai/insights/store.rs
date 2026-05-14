//! SQLite tables for the insights engine.
//!
//! Lives alongside `ai_usage` in the same `.mycel/ai/index.db` so a paranoid
//! user has one file to inspect or delete. Migrations are additive: each
//! `CREATE TABLE IF NOT EXISTS` is safe on every open.
//!
//! Tables:
//!   - `insights`            one row per insight ever shown to the user
//!   - `dismissed_insights`  cooldown by signature (= hash of kind+notes)
//!   - `insight_telemetry`   shown/acted/dismissed events for the report
//!   - `insights_runs`       scheduler bookkeeping (timing, errors)

use anyhow::Result;
use rusqlite::{params, Connection};

use super::detector::signature;
use super::models::{
    DetectorTelemetry, Insight, InsightKind, InsightStatus, TelemetryReport,
};
use crate::core::ai::store::AiStore;

/// Per-call cooldown override. Most call sites use the user's configured
/// default; tests and the "verify cooldown works" check use a custom value.
pub fn dismiss_with_cooldown(
    store: &AiStore,
    insight_id: &str,
    cooldown_days: i64,
    now: i64,
) -> Result<()> {
    store.with_conn(|conn| {
        let row = conn.query_row(
            "SELECT kind, note_paths FROM insights WHERE id = ?1",
            params![insight_id],
            |r| Ok((r.get::<_, String>(0)?, r.get::<_, String>(1)?)),
        );
        let (kind, note_paths_json) = match row {
            Ok(v) => v,
            Err(rusqlite::Error::QueryReturnedNoRows) => return Ok(()),
            Err(e) => return Err(e.into()),
        };
        let note_paths: Vec<String> =
            serde_json::from_str(&note_paths_json).unwrap_or_default();

        // Re-derive the signature from the stored row so the on-disk format
        // and the in-memory one agree. (Insights re-discovered by a detector
        // recompute the same signature against the same kind+paths.)
        let mut paths = note_paths.clone();
        paths.sort();
        let raw = format!("{}|{}", kind, paths.join(","));
        let sig = sha256_hex(&raw);

        let cooldown_until = now + cooldown_days * 86_400;

        conn.execute(
            "INSERT INTO dismissed_insights(signature, kind, note_paths, dismissed_at, cooldown_until)
             VALUES(?1, ?2, ?3, ?4, ?5)
             ON CONFLICT(signature) DO UPDATE SET
               dismissed_at = excluded.dismissed_at,
               cooldown_until = excluded.cooldown_until",
            params![sig, kind, note_paths_json, now, cooldown_until],
        )?;

        conn.execute(
            "UPDATE insights SET status = 'dismissed' WHERE id = ?1",
            params![insight_id],
        )?;
        Ok(())
    })
}

fn sha256_hex(s: &str) -> String {
    use sha2::{Digest, Sha256};
    let d = Sha256::digest(s.as_bytes());
    let mut out = String::with_capacity(d.len() * 2);
    for b in d {
        out.push_str(&format!("{:02x}", b));
    }
    out
}

/// Idempotent schema bootstrap. Called from `ensure_insights_schema` on every
/// `AiState` build, so a fresh vault gets the tables the first time the user
/// opens the Insights tab or Settings.
pub fn init_schema(conn: &Connection) -> Result<()> {
    conn.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS insights (
          id            TEXT    PRIMARY KEY,
          kind          TEXT    NOT NULL,
          detector_name TEXT    NOT NULL DEFAULT '',
          confidence    REAL    NOT NULL,
          title         TEXT    NOT NULL,
          body          TEXT    NOT NULL,
          note_paths    TEXT    NOT NULL,
          actions       TEXT    NOT NULL,
          external_refs TEXT    NOT NULL DEFAULT '[]',
          generated_at  INTEGER NOT NULL,
          status        TEXT    NOT NULL DEFAULT 'pending'
        );
        CREATE INDEX IF NOT EXISTS idx_insights_status    ON insights(status);
        CREATE INDEX IF NOT EXISTS idx_insights_generated ON insights(generated_at);

        CREATE TABLE IF NOT EXISTS dismissed_insights (
          signature      TEXT    PRIMARY KEY,
          kind           TEXT    NOT NULL,
          note_paths     TEXT    NOT NULL,
          dismissed_at   INTEGER NOT NULL,
          cooldown_until INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_dismissed_cooldown
          ON dismissed_insights(cooldown_until);

        CREATE TABLE IF NOT EXISTS insight_telemetry (
          id              INTEGER PRIMARY KEY AUTOINCREMENT,
          detector_name   TEXT    NOT NULL,
          event           TEXT    NOT NULL,
          insight_id      TEXT    NOT NULL,
          occurred_at     INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_telemetry_detector ON insight_telemetry(detector_name);
        CREATE INDEX IF NOT EXISTS idx_telemetry_event    ON insight_telemetry(event);
        CREATE INDEX IF NOT EXISTS idx_telemetry_when     ON insight_telemetry(occurred_at);

        CREATE TABLE IF NOT EXISTS insights_runs (
          id                  INTEGER PRIMARY KEY AUTOINCREMENT,
          started_at          INTEGER NOT NULL,
          finished_at         INTEGER,
          status              TEXT    NOT NULL,
          detectors_run       INTEGER NOT NULL DEFAULT 0,
          insights_generated  INTEGER NOT NULL DEFAULT 0,
          error               TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_runs_started ON insights_runs(started_at);
        "#,
    )?;

    // Migration for vaults whose `insights` table predates the
    // `detector_name` column (created by an early build of this branch).
    // `CREATE TABLE IF NOT EXISTS` above leaves an existing table untouched,
    // so we add the column explicitly and swallow the "duplicate column"
    // error that fires when it's already there.
    if let Err(e) = conn.execute(
        "ALTER TABLE insights ADD COLUMN detector_name TEXT NOT NULL DEFAULT ''",
        [],
    ) {
        let msg = e.to_string();
        if !msg.contains("duplicate column name") {
            return Err(e.into());
        }
    }

    Ok(())
}

pub fn ensure_insights_schema(store: &AiStore) -> Result<()> {
    store.with_conn(|c| init_schema(c))
}

/// Persist a freshly-generated insight, or update its body if a detector
/// produced the same stable id again. We upsert because re-running a
/// detector mid-day should refresh `confidence` / `body` rather than crash
/// on a primary-key collision.
pub fn save_insight(store: &AiStore, detector_name: &str, insight: &Insight) -> Result<()> {
    store.with_conn(|conn| {
        conn.execute(
            "INSERT INTO insights(
               id, kind, detector_name, confidence, title, body, note_paths, actions,
               external_refs, generated_at, status
             ) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,'pending')
             ON CONFLICT(id) DO UPDATE SET
               kind          = excluded.kind,
               detector_name = excluded.detector_name,
               confidence    = excluded.confidence,
               title         = excluded.title,
               body          = excluded.body,
               note_paths    = excluded.note_paths,
               actions       = excluded.actions,
               external_refs = excluded.external_refs,
               generated_at  = excluded.generated_at",
            params![
                insight.id,
                insight.kind.as_key(),
                detector_name,
                insight.confidence as f64,
                insight.title,
                insight.body,
                serde_json::to_string(&insight.note_paths)?,
                serde_json::to_string(&insight.actions)?,
                serde_json::to_string(&insight.external_refs)?,
                insight.generated_at,
            ],
        )?;
        Ok(())
    })
}

/// Returns the detector_name that produced `insight_id`, if known. Empty
/// string for legacy rows from before the column existed.
pub fn detector_of(store: &AiStore, insight_id: &str) -> Result<Option<String>> {
    store.with_conn(|conn| {
        match conn.query_row(
            "SELECT detector_name FROM insights WHERE id = ?1",
            params![insight_id],
            |r| r.get::<_, String>(0),
        ) {
            Ok(s) => Ok(Some(s)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    })
}

pub fn list_insights(
    store: &AiStore,
    status: Option<InsightStatus>,
    limit: i64,
) -> Result<Vec<Insight>> {
    store.with_conn(|conn| {
        let (sql, status_str) = if let Some(s) = status {
            (
                "SELECT id, kind, confidence, title, body, note_paths, actions,
                        external_refs, generated_at
                 FROM insights WHERE status = ?1
                 ORDER BY confidence DESC, generated_at DESC LIMIT ?2",
                Some(s.as_str()),
            )
        } else {
            (
                "SELECT id, kind, confidence, title, body, note_paths, actions,
                        external_refs, generated_at
                 FROM insights
                 ORDER BY confidence DESC, generated_at DESC LIMIT ?1",
                None,
            )
        };

        let mut stmt = conn.prepare(sql)?;
        let mapper = |r: &rusqlite::Row<'_>| -> rusqlite::Result<Insight> {
            let kind_str: String = r.get(1)?;
            let kind = parse_kind(&kind_str)
                .ok_or_else(|| rusqlite::Error::InvalidQuery)?;
            let note_paths: Vec<String> =
                serde_json::from_str::<Vec<String>>(&r.get::<_, String>(5)?)
                    .map_err(|_| rusqlite::Error::InvalidQuery)?;
            let actions = serde_json::from_str(&r.get::<_, String>(6)?)
                .map_err(|_| rusqlite::Error::InvalidQuery)?;
            let external_refs = serde_json::from_str(&r.get::<_, String>(7)?)
                .map_err(|_| rusqlite::Error::InvalidQuery)?;
            Ok(Insight {
                id: r.get(0)?,
                kind,
                confidence: r.get::<_, f64>(2)? as f32,
                title: r.get(3)?,
                body: r.get(4)?,
                note_paths,
                actions,
                external_refs,
                generated_at: r.get(8)?,
            })
        };

        let rows: Vec<Insight> = if let Some(s) = status_str {
            stmt.query_map(params![s, limit], mapper)?
                .collect::<rusqlite::Result<Vec<_>>>()?
        } else {
            stmt.query_map(params![limit], mapper)?
                .collect::<rusqlite::Result<Vec<_>>>()?
        };
        Ok(rows)
    })
}

pub fn mark_acted(store: &AiStore, insight_id: &str) -> Result<()> {
    store.with_conn(|conn| {
        conn.execute(
            "UPDATE insights SET status = 'acted' WHERE id = ?1",
            params![insight_id],
        )?;
        Ok(())
    })
}

/// Drop insights whose signature is in cooldown. Returns the surviving set
/// in the same order it came in (callers do their own ranking after).
pub fn filter_against_dismissed(
    store: &AiStore,
    insights: Vec<Insight>,
    now: i64,
) -> Result<Vec<Insight>> {
    if insights.is_empty() {
        return Ok(insights);
    }
    let dead: std::collections::HashSet<String> = store.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT signature FROM dismissed_insights WHERE cooldown_until > ?1",
        )?;
        let rows = stmt
            .query_map(params![now], |r| r.get::<_, String>(0))?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows.into_iter().collect())
    })?;

    Ok(insights
        .into_iter()
        .filter(|i| !dead.contains(&signature(i)))
        .collect())
}

pub fn log_telemetry(
    store: &AiStore,
    detector_name: &str,
    event: &str,
    insight_id: &str,
    now: i64,
) -> Result<()> {
    store.with_conn(|conn| {
        conn.execute(
            "INSERT INTO insight_telemetry(detector_name, event, insight_id, occurred_at)
             VALUES(?1, ?2, ?3, ?4)",
            params![detector_name, event, insight_id, now],
        )?;
        Ok(())
    })
}

pub fn telemetry_report(store: &AiStore, days: u32, now: i64) -> Result<TelemetryReport> {
    let since = now - (days as i64) * 86_400;
    let rows = store.with_conn(|conn| {
        let mut stmt = conn.prepare(
            "SELECT detector_name,
                    SUM(CASE WHEN event='shown'     THEN 1 ELSE 0 END) AS shown,
                    SUM(CASE WHEN event='acted'     THEN 1 ELSE 0 END) AS acted,
                    SUM(CASE WHEN event='dismissed' THEN 1 ELSE 0 END) AS dismissed
             FROM insight_telemetry
             WHERE occurred_at >= ?1
             GROUP BY detector_name
             ORDER BY shown DESC",
        )?;
        let rows = stmt
            .query_map(params![since], |r| {
                Ok(DetectorTelemetry {
                    detector_name: r.get(0)?,
                    shown: r.get::<_, i64>(1)? as u32,
                    acted: r.get::<_, i64>(2)? as u32,
                    dismissed: r.get::<_, i64>(3)? as u32,
                })
            })?
            .collect::<rusqlite::Result<Vec<_>>>()?;
        Ok(rows)
    })?;
    Ok(TelemetryReport { days, rows })
}

pub fn start_run(store: &AiStore, now: i64) -> Result<i64> {
    store.with_conn(|conn| {
        conn.execute(
            "INSERT INTO insights_runs(started_at, status) VALUES(?1, 'running')",
            params![now],
        )?;
        Ok(conn.last_insert_rowid())
    })
}

pub fn finish_run(
    store: &AiStore,
    run_id: i64,
    finished_at: i64,
    detectors_run: usize,
    insights_generated: usize,
    error: Option<&str>,
) -> Result<()> {
    let status = if error.is_some() { "failed" } else { "success" };
    store.with_conn(|conn| {
        conn.execute(
            "UPDATE insights_runs
             SET finished_at = ?1, status = ?2, detectors_run = ?3,
                 insights_generated = ?4, error = ?5
             WHERE id = ?6",
            params![
                finished_at,
                status,
                detectors_run as i64,
                insights_generated as i64,
                error,
                run_id
            ],
        )?;
        Ok(())
    })
}

/// Time the last successful run finished, or None if the engine has never
/// completed a run on this vault. Used by the scheduler's catch-up logic.
pub fn last_successful_run_at(store: &AiStore) -> Result<Option<i64>> {
    store.with_conn(|conn| {
        let v: rusqlite::Result<i64> = conn.query_row(
            "SELECT COALESCE(MAX(finished_at), 0) FROM insights_runs WHERE status = 'success'",
            [],
            |r| r.get(0),
        );
        Ok(match v {
            Ok(0) => None,
            Ok(n) => Some(n),
            Err(rusqlite::Error::QueryReturnedNoRows) => None,
            Err(e) => return Err(e.into()),
        })
    })
}

fn parse_kind(s: &str) -> Option<InsightKind> {
    Some(match s {
        "missing_wikilink" => InsightKind::MissingWikilink,
        "bridge_candidate" => InsightKind::BridgeCandidate,
        "resurfacing" => InsightKind::Resurfacing,
        "today_companion" => InsightKind::TodayCompanion,
        "question_answered" => InsightKind::QuestionAnswered,
        "news_for_theme" => InsightKind::NewsForTheme,
        "echo" => InsightKind::Echo,
        "stranded_note" => InsightKind::StrandedNote,
        "emerging_theme" => InsightKind::EmergingTheme,
        "problem_researched" => InsightKind::ProblemResearched,
        "idea_state_of_art" => InsightKind::IdeaStateOfArt,
        _ => return None,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::ai::insights::detector::stable_id;
    use crate::core::ai::insights::models::InsightAction;

    fn fresh() -> AiStore {
        let s = AiStore::open_in_memory().unwrap();
        ensure_insights_schema(&s).unwrap();
        s
    }

    fn mk(id: &str, kind: InsightKind, paths: Vec<&str>) -> Insight {
        Insight {
            id: id.into(),
            kind,
            confidence: 0.8,
            title: "title".into(),
            body: "body".into(),
            note_paths: paths.into_iter().map(String::from).collect(),
            actions: vec![InsightAction::OpenNote {
                note_path: "x.md".into(),
            }],
            external_refs: vec![],
            generated_at: 1000,
        }
    }

    #[test]
    fn save_and_list_round_trip() {
        let s = fresh();
        let id = stable_id("missing_wikilink", &["a.md".into(), "b.md".into()], &[]);
        let ins = mk(&id, InsightKind::MissingWikilink, vec!["a.md", "b.md"]);
        save_insight(&s, "_test", &ins).unwrap();
        let listed = list_insights(&s, Some(InsightStatus::Pending), 10).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, id);
        assert_eq!(listed[0].note_paths, vec!["a.md", "b.md"]);
    }

    #[test]
    fn dismiss_blocks_reappearance() {
        let s = fresh();
        let id = stable_id("missing_wikilink", &["a.md".into(), "b.md".into()], &[]);
        let ins = mk(&id, InsightKind::MissingWikilink, vec!["a.md", "b.md"]);
        save_insight(&s, "_test", &ins).unwrap();
        dismiss_with_cooldown(&s, &id, 14, 1000).unwrap();

        // Same signature, re-discovered by tomorrow's run:
        let again = mk(&id, InsightKind::MissingWikilink, vec!["b.md", "a.md"]);
        let kept = filter_against_dismissed(&s, vec![again], 2000).unwrap();
        assert!(kept.is_empty(), "dismissed insight must not pass filter");
    }

    #[test]
    fn expired_cooldown_lets_insight_back() {
        let s = fresh();
        let id = stable_id("missing_wikilink", &["a.md".into(), "b.md".into()], &[]);
        let ins = mk(&id, InsightKind::MissingWikilink, vec!["a.md", "b.md"]);
        save_insight(&s, "_test", &ins).unwrap();
        dismiss_with_cooldown(&s, &id, 0, 1000).unwrap(); // immediate expiry

        let again = mk(&id, InsightKind::MissingWikilink, vec!["a.md", "b.md"]);
        let kept = filter_against_dismissed(&s, vec![again], 2000).unwrap();
        assert_eq!(kept.len(), 1);
    }

    #[test]
    fn telemetry_aggregates_per_detector() {
        let s = fresh();
        log_telemetry(&s, "det_a", "shown", "i1", 1000).unwrap();
        log_telemetry(&s, "det_a", "shown", "i2", 1001).unwrap();
        log_telemetry(&s, "det_a", "acted", "i1", 1002).unwrap();
        log_telemetry(&s, "det_b", "shown", "i3", 1003).unwrap();
        log_telemetry(&s, "det_b", "dismissed", "i3", 1004).unwrap();

        let report = telemetry_report(&s, 30, 1_000_000).unwrap();
        let a = report.rows.iter().find(|r| r.detector_name == "det_a").unwrap();
        assert_eq!(a.shown, 2);
        assert_eq!(a.acted, 1);
        assert_eq!(a.dismissed, 0);
        let b = report.rows.iter().find(|r| r.detector_name == "det_b").unwrap();
        assert_eq!(b.shown, 1);
        assert_eq!(b.dismissed, 1);
    }

    #[test]
    fn run_lifecycle_tracks_success() {
        let s = fresh();
        let run = start_run(&s, 100).unwrap();
        finish_run(&s, run, 200, 3, 5, None).unwrap();
        let when = last_successful_run_at(&s).unwrap();
        assert_eq!(when, Some(200));
    }
}
