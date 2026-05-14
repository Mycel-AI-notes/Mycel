//! Daily scheduler + ranking pipeline for the Insights engine.
//!
//! One tokio task per open vault. It wakes every minute and asks:
//!   - is the master toggle on?
//!   - did the configured `HH:MM` already pass today?
//!   - did we already run today?
//! If all three answer yes, it runs the pipeline.
//!
//! The pipeline:
//!   1. Each enabled detector produces 0..N insights.
//!   2. Insights whose signature is in active cooldown are dropped.
//!   3. Survivors are ranked by confidence, with per-kind and total caps.
//!   4. The top set is persisted and a `shown` event is logged per insight.
//!
//! Phase 1 ships an empty detector registry (plus an optional debug-build
//! mock). The whole pipeline still runs end-to-end so we can ship the UI on
//! day one and watch it behave with zero, one, or many insights.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use anyhow::Result;
use chrono::{Local, TimeZone, Timelike};
use tokio::sync::Mutex;

use super::detector::{Detector, DetectorContext};
use super::models::{Insight, InsightKind, RunSummary};
use super::settings::InsightsSettings;
use super::store as istore;
use crate::core::ai::config::AiConfig;
use crate::core::ai::embedder::OpenRouterEmbedder;
use crate::core::ai::store::AiStore;
use crate::core::ai::{indexer, keyring};

/// Owns the detector registry and the runtime knobs the tokio loop needs.
/// Cloning is cheap (`Arc`s all the way down) so the Tauri command layer can
/// hand the scheduler to multiple call sites — `insights_run_now` and the
/// background tick — without coordination.
#[derive(Clone)]
pub struct InsightsEngine {
    pub vault_root: PathBuf,
    pub store: Arc<AiStore>,
    pub settings: Arc<Mutex<InsightsSettings>>,
    pub detectors: Arc<Vec<Box<dyn Detector>>>,
    /// Shared with `AiState` — the embedding config (model, daily budget) the
    /// pre-run index refresh needs.
    pub config: Arc<Mutex<AiConfig>>,
    /// Shared with `AiState::indexing` — held while the pre-run reindex walks
    /// the vault so it can't race the file-watcher's single-note indexer.
    pub indexing: Arc<Mutex<()>>,
    /// Date string (`YYYY-MM-DD` in local time) of the last completed run.
    /// Lets the per-minute tick early-out without touching SQL.
    pub last_run_date: Arc<Mutex<Option<String>>>,
}

impl InsightsEngine {
    pub fn new(
        vault_root: PathBuf,
        store: Arc<AiStore>,
        settings: InsightsSettings,
        detectors: Vec<Box<dyn Detector>>,
        config: Arc<Mutex<AiConfig>>,
        indexing: Arc<Mutex<()>>,
    ) -> Self {
        Self {
            vault_root,
            store,
            settings: Arc::new(Mutex::new(settings)),
            detectors: Arc::new(detectors),
            config,
            indexing,
            last_run_date: Arc::new(Mutex::new(None)),
        }
    }

    /// Spawn the per-minute tick. Returns the JoinHandle so tests can stop
    /// the loop; production code drops it and lets the task live for the
    /// lifetime of the AiState.
    pub fn spawn(self) -> tokio::task::JoinHandle<()> {
        tokio::spawn(async move {
            // First tick fires immediately so a fresh process can catch up on
            // a missed scheduled run without waiting a minute.
            let mut interval = tokio::time::interval(Duration::from_secs(60));
            loop {
                interval.tick().await;
                if let Err(e) = self.maybe_run().await {
                    eprintln!("insights scheduler tick failed: {:#}", e);
                }
            }
        })
    }

    async fn maybe_run(&self) -> Result<()> {
        let settings = self.settings.lock().await.clone();
        if !settings.enabled {
            return Ok(());
        }
        let now = Local::now();
        let today = now.format("%Y-%m-%d").to_string();

        let already = {
            let guard = self.last_run_date.lock().await;
            guard.as_deref() == Some(today.as_str())
        };
        if already {
            return Ok(());
        }

        // Has the configured HH:MM passed today?
        let (h, m) = settings.schedule_hm();
        let scheduled = now
            .with_hour(h)
            .and_then(|t| t.with_minute(m))
            .and_then(|t| t.with_second(0));
        let Some(scheduled) = scheduled else {
            return Ok(());
        };
        if now < scheduled {
            return Ok(());
        }

        // Catch-up: if last successful run was before today's scheduled time,
        // we missed it (app was closed). Run now if catch-up is on.
        if !settings.schedule.catch_up {
            // strict mode: only run if we're within the same minute as the
            // scheduled time. Avoids "open app at noon, immediately get a
            // run" surprises for users who explicitly disabled catch-up.
            if now.hour() != h || now.minute() != m {
                return Ok(());
            }
        }

        let _ = self.run_once(&settings).await?;
        *self.last_run_date.lock().await = Some(today);
        Ok(())
    }

    /// Bring the embedding index up to date before detectors read it.
    ///
    /// The insights scheduler doesn't own the index, but a stale index makes
    /// the similar-notes detector miss recently-edited notes. `bulk_reindex`
    /// is the incremental updater — it walks the vault but the indexer skips
    /// unchanged chunks by hash, so steady-state this is cheap.
    ///
    /// Best-effort: if AI is off, no key is saved, or the reindex errors, we
    /// log and carry on with whatever is already indexed — a stale index is
    /// better than no insights run.
    async fn refresh_index(&self) {
        let cfg = self.config.lock().await.clone();
        if !cfg.enabled {
            return;
        }
        let key = match keyring::get_key(&self.vault_root) {
            Ok(Some(k)) => k,
            Ok(None) => return,
            Err(e) => {
                eprintln!("insights: keyring read failed before reindex: {e}");
                return;
            }
        };
        // Serialize with the file-watcher's single-note indexer and any
        // manual "Reindex now" — same lock `commands::ai::index` takes.
        let _guard = self.indexing.lock().await;
        let embedder = OpenRouterEmbedder::new(key, cfg.embedding_model.clone());
        if let Err(e) = indexer::bulk_reindex(
            &self.store,
            &embedder,
            &self.vault_root,
            cfg.daily_budget_usd,
            &cfg.embedding_model,
            |_p: indexer::BulkProgress| {},
        )
        .await
        {
            eprintln!("insights: pre-run reindex failed: {:#}", e);
        }
    }

    /// Run the pipeline end-to-end and return a summary. Used directly by
    /// `insights_run_now`; the scheduler tick just throws the summary away.
    pub async fn run_once(&self, settings: &InsightsSettings) -> Result<RunSummary> {
        // Freshen the embedding index first so detectors see recent edits.
        self.refresh_index().await;

        let now = chrono::Utc::now().timestamp();
        let run_id = istore::start_run(&self.store, now)?;
        let mut errors: Vec<String> = Vec::new();
        let mut all: Vec<(String, Insight)> = Vec::new(); // (detector_name, insight)
        let mut ran = 0usize;

        let ctx = DetectorContext {
            store: self.store.clone(),
            vault_root: &self.vault_root,
            settings,
            // Phase 3+ wires real flags. The detectors shipped so far don't
            // need live LLM/web access, so default-false is harmless.
            has_llm: false,
            has_web: false,
        };

        for d in self.detectors.iter() {
            // A detector runs if the user explicitly enabled it in settings,
            // or — when it's not in the settings dict yet — if it ships
            // enabled by default. Without the `enabled_by_default` fallback a
            // brand-new detector (or the debug mock) would run the moment it
            // exists, which is not what `enabled_by_default() == false` means.
            let enabled = match settings.detectors.get(d.name()) {
                Some(&v) => v,
                None => d.enabled_by_default(),
            };
            if !enabled {
                continue;
            }
            if d.requires_llm() && !ctx.has_llm {
                continue;
            }
            if d.requires_web() && !ctx.has_web {
                continue;
            }
            ran += 1;
            match d.run(&ctx).await {
                Ok(insights) => {
                    for ins in insights {
                        all.push((d.name().to_string(), ins));
                    }
                }
                Err(e) => {
                    eprintln!("detector {} failed: {:#}", d.name(), e);
                    errors.push(format!("{}: {:#}", d.name(), e));
                }
            }
        }

        // Cooldown filter, then ranking. We have to keep detector_name
        // alongside each insight all the way through ranking so the "shown"
        // event lands on the right row in `insight_telemetry`.
        let insights_only: Vec<Insight> = all.iter().map(|(_, i)| i.clone()).collect();
        let kept = istore::filter_against_dismissed(&self.store, insights_only, now)?;
        let kept_ids: std::collections::HashSet<String> =
            kept.iter().map(|i| i.id.clone()).collect();
        let filtered: Vec<(String, Insight)> = all
            .into_iter()
            .filter(|(_, i)| kept_ids.contains(&i.id))
            .collect();

        let final_set = pick_top_with_quota(
            filtered,
            settings.limits.max_per_day as usize,
            settings.limits.max_per_kind as usize,
        );

        for (detector_name, ins) in &final_set {
            istore::save_insight(&self.store, detector_name, ins)?;
            istore::log_telemetry(&self.store, detector_name, "shown", &ins.id, now)?;
        }

        let finished = chrono::Utc::now().timestamp();
        istore::finish_run(
            &self.store,
            run_id,
            finished,
            ran,
            final_set.len(),
            // We don't mark the whole run as failed when an individual
            // detector errors — that information is in the errors list and
            // a partial run is still a successful run for everyone else.
            None,
        )?;

        Ok(RunSummary {
            started_at: now,
            finished_at: finished,
            detectors_run: ran,
            insights_generated: final_set.len(),
            errors,
        })
    }
}

/// Rank by confidence (desc), then enforce both an overall cap and a per-kind
/// cap. The per-kind cap is what prevents one chatty detector from filling
/// the entire inbox.
pub fn pick_top_with_quota(
    mut tagged: Vec<(String, Insight)>,
    total: usize,
    per_kind: usize,
) -> Vec<(String, Insight)> {
    tagged.sort_by(|a, b| {
        b.1.confidence
            .partial_cmp(&a.1.confidence)
            .unwrap_or(std::cmp::Ordering::Equal)
    });
    let mut counts: HashMap<&'static str, usize> = HashMap::new();
    let mut out = Vec::with_capacity(total.min(tagged.len()));
    for (name, ins) in tagged {
        if out.len() >= total {
            break;
        }
        let key = kind_key(&ins.kind);
        let c = counts.entry(key).or_insert(0);
        if *c >= per_kind {
            continue;
        }
        *c += 1;
        out.push((name, ins));
    }
    out
}

fn kind_key(k: &InsightKind) -> &'static str {
    k.as_key()
}

/// Catch-up entrypoint, called once when AiState is built. Different from
/// the tick loop because it runs unconditionally if the conditions are met
/// (it doesn't wait for the next minute boundary). Returns `Ok(None)` when
/// no catch-up was needed.
pub async fn run_catch_up_if_due(engine: &InsightsEngine) -> Result<Option<RunSummary>> {
    let settings = engine.settings.lock().await.clone();
    if !settings.enabled || !settings.schedule.catch_up {
        return Ok(None);
    }
    let now = Local::now();
    let (h, m) = settings.schedule_hm();
    let scheduled = now
        .with_hour(h)
        .and_then(|t| t.with_minute(m))
        .and_then(|t| t.with_second(0));
    let Some(scheduled) = scheduled else {
        return Ok(None);
    };
    if now < scheduled {
        return Ok(None);
    }

    let last = istore::last_successful_run_at(&engine.store)?;
    let scheduled_unix = Local
        .from_local_datetime(&scheduled.naive_local())
        .single()
        .map(|d| d.timestamp())
        .unwrap_or(0);
    let needs_catch_up = match last {
        None => true,
        Some(t) => t < scheduled_unix,
    };
    if !needs_catch_up {
        return Ok(None);
    }

    let summary = engine.run_once(&settings).await?;
    *engine.last_run_date.lock().await = Some(now.format("%Y-%m-%d").to_string());
    Ok(Some(summary))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::ai::insights::models::{InsightAction, InsightKind};

    fn ins(id: &str, kind: InsightKind, conf: f32) -> Insight {
        Insight {
            id: id.into(),
            kind,
            confidence: conf,
            title: "t".into(),
            body: "b".into(),
            note_paths: vec!["a.md".into()],
            actions: vec![InsightAction::OpenNote {
                note_path: "a.md".into(),
            }],
            external_refs: vec![],
            generated_at: 0,
        }
    }

    #[test]
    fn quota_caps_total() {
        let inputs = vec![
            ("d1".into(), ins("a", InsightKind::MissingWikilink, 0.9)),
            ("d1".into(), ins("b", InsightKind::BridgeCandidate, 0.8)),
            ("d1".into(), ins("c", InsightKind::Resurfacing, 0.7)),
            ("d1".into(), ins("d", InsightKind::Echo, 0.6)),
        ];
        let out = pick_top_with_quota(inputs, 2, 3);
        assert_eq!(out.len(), 2);
        assert_eq!(out[0].1.id, "a");
        assert_eq!(out[1].1.id, "b");
    }

    #[test]
    fn quota_caps_per_kind() {
        let inputs = vec![
            ("d".into(), ins("a", InsightKind::MissingWikilink, 0.95)),
            ("d".into(), ins("b", InsightKind::MissingWikilink, 0.9)),
            ("d".into(), ins("c", InsightKind::MissingWikilink, 0.85)),
            ("d".into(), ins("d", InsightKind::MissingWikilink, 0.8)),
            ("d".into(), ins("e", InsightKind::BridgeCandidate, 0.5)),
        ];
        let out = pick_top_with_quota(inputs, 10, 2);
        assert_eq!(out.len(), 3, "two missing_wikilinks + one bridge");
        let kinds: Vec<_> = out.iter().map(|(_, i)| i.kind.as_key()).collect();
        assert_eq!(
            kinds.iter().filter(|k| **k == "missing_wikilink").count(),
            2
        );
    }
}
