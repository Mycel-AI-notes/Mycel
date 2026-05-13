//! Daily token / cost ledger for OpenRouter calls.
//!
//! `check(model, est_cost_usd)` is called BEFORE a request goes out; it
//! returns `Err(BudgetExceeded { .. })` if adding `est_cost_usd` to today's
//! recorded spend would exceed `daily_budget_usd`.
//!
//! `record(model, tokens_in, tokens_out, cost_usd)` is called AFTER a
//! successful response with the actual usage from the OpenRouter response.
//!
//! Rows are keyed by local date (YYYY-MM-DD), so "midnight reset" is just
//! "tomorrow gets a new row". No background timer needed.

use anyhow::Result;
use chrono::Local;
use thiserror::Error;

use super::store::AiStore;

#[derive(Debug, Error)]
pub enum BudgetError {
    #[error("daily AI budget exceeded ({spent_usd:.4} of {limit_usd:.2} USD spent today)")]
    Exceeded { spent_usd: f64, limit_usd: f64 },
}

/// Cost the proposed call would have if it succeeded with the worst-case
/// token count we expect. Conservative — we'd rather block a request that
/// turns out to be under budget than approve one that overshoots.
pub fn check(store: &AiStore, limit_usd: f64, model: &str, est_cost_usd: f64) -> Result<()> {
    let today = today();
    let spent = store.with_conn(|c| {
        let spent: f64 = c
            .query_row(
                "SELECT COALESCE(SUM(cost_usd), 0) FROM ai_usage WHERE date = ?1",
                [&today],
                |r| r.get(0),
            )
            .unwrap_or(0.0);
        Ok(spent)
    })?;
    if spent + est_cost_usd > limit_usd {
        return Err(BudgetError::Exceeded {
            spent_usd: spent,
            limit_usd,
        }
        .into());
    }
    let _ = model; // reserved for per-model limits in a future revision
    Ok(())
}

pub fn record(
    store: &AiStore,
    model: &str,
    tokens_in: u64,
    tokens_out: u64,
    cost_usd: f64,
) -> Result<()> {
    let today = today();
    store.with_conn(|c| {
        c.execute(
            r#"
            INSERT INTO ai_usage (date, model, tokens_in, tokens_out, cost_usd)
            VALUES (?1, ?2, ?3, ?4, ?5)
            ON CONFLICT(date, model) DO UPDATE SET
              tokens_in  = tokens_in  + excluded.tokens_in,
              tokens_out = tokens_out + excluded.tokens_out,
              cost_usd   = cost_usd   + excluded.cost_usd
            "#,
            rusqlite::params![today, model, tokens_in as i64, tokens_out as i64, cost_usd],
        )?;
        Ok(())
    })
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct DailyUsage {
    pub date: String,
    pub tokens_in: u64,
    pub tokens_out: u64,
    pub cost_usd: f64,
}

pub fn today_usage(store: &AiStore) -> Result<DailyUsage> {
    let today = today();
    store.with_conn(|c| {
        let row = c
            .query_row(
                r#"
                SELECT COALESCE(SUM(tokens_in), 0),
                       COALESCE(SUM(tokens_out), 0),
                       COALESCE(SUM(cost_usd), 0)
                FROM ai_usage WHERE date = ?1
                "#,
                [&today],
                |r| Ok((r.get::<_, i64>(0)?, r.get::<_, i64>(1)?, r.get::<_, f64>(2)?)),
            )
            .unwrap_or((0, 0, 0.0));
        Ok(DailyUsage {
            date: today,
            tokens_in: row.0.max(0) as u64,
            tokens_out: row.1.max(0) as u64,
            cost_usd: row.2,
        })
    })
}

fn today() -> String {
    Local::now().format("%Y-%m-%d").to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn check_passes_when_under_limit() {
        let store = AiStore::open_in_memory().unwrap();
        check(&store, 1.0, "m", 0.5).unwrap();
    }

    #[test]
    fn record_accumulates_within_a_day() {
        let store = AiStore::open_in_memory().unwrap();
        record(&store, "m", 100, 0, 0.10).unwrap();
        record(&store, "m", 200, 0, 0.20).unwrap();
        let u = today_usage(&store).unwrap();
        assert_eq!(u.tokens_in, 300);
        assert!((u.cost_usd - 0.30).abs() < 1e-9);
    }

    #[test]
    fn check_blocks_once_over_budget() {
        let store = AiStore::open_in_memory().unwrap();
        record(&store, "m", 0, 0, 0.95).unwrap();
        let err = check(&store, 1.0, "m", 0.10).unwrap_err();
        assert!(err.to_string().contains("budget"));
    }

    #[test]
    fn separate_models_share_a_budget() {
        // Same day, different model rows — they still sum into one daily total.
        let store = AiStore::open_in_memory().unwrap();
        record(&store, "a", 0, 0, 0.40).unwrap();
        record(&store, "b", 0, 0, 0.40).unwrap();
        let err = check(&store, 1.0, "c", 0.25).unwrap_err();
        assert!(err.to_string().contains("budget"));
    }
}
