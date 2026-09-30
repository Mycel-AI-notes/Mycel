//! Per-model USD pricing for the daily-budget ledger.
//!
//! Both the embedding and the chat cost used to be single hard-coded constants
//! — `0.02` per million for `text-embedding-3-small`, and `0.60 / 2.40` for a
//! cheap chat tier — while `embedding_model` and `chat_model` are both settings
//! the user can change. Point either at something dearer and the ledger
//! undercounted, so `daily_budget_usd` stopped meaning what it says. The budget
//! is the one thing standing between a background reindex and a surprise
//! invoice, so it has to track the model actually being called.
//!
//! Rates are hard-coded rather than fetched so the budget check stays
//! offline-safe. The OpenRouter dashboard remains the source of truth; drift
//! here shows up as a ledger that reads slightly low, not as a runaway.
//!
//! An unknown model falls back to a deliberately expensive estimate. Erring
//! high means the ceiling trips earlier than it strictly had to, which costs
//! the user an explicit "raise the budget" decision. Erring low means spending
//! money they did not agree to.

/// Input and output rates in USD per million tokens.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ChatPrice {
    pub input_per_million: f64,
    pub output_per_million: f64,
}

/// Rates as of 2026-05.
const EMBEDDING_PRICES: &[(&str, f64)] = &[
    ("openai/text-embedding-3-small", 0.02),
    ("openai/text-embedding-3-large", 0.13),
    ("openai/text-embedding-ada-002", 0.10),
];

const CHAT_PRICES: &[(&str, ChatPrice)] = &[
    (
        "openai/gpt-4o-mini",
        ChatPrice {
            input_per_million: 0.15,
            output_per_million: 0.60,
        },
    ),
    (
        "openai/gpt-4o",
        ChatPrice {
            input_per_million: 2.50,
            output_per_million: 10.00,
        },
    ),
    (
        "anthropic/claude-3.5-haiku",
        ChatPrice {
            input_per_million: 0.80,
            output_per_million: 4.00,
        },
    ),
];

/// Stand-in for an embedding model we have no rate for: an order of magnitude
/// above the cheap tier.
const UNKNOWN_EMBEDDING_PER_MILLION: f64 = 0.20;

/// Stand-in for an unknown chat model, around the frontier tier.
const UNKNOWN_CHAT: ChatPrice = ChatPrice {
    input_per_million: 5.00,
    output_per_million: 15.00,
};

fn lookup<T: Copy>(table: &[(&str, T)], model: &str) -> Option<T> {
    table
        .iter()
        .find(|(name, _)| name.eq_ignore_ascii_case(model))
        .map(|(_, price)| *price)
}

/// Whether the ledger has a real rate for this model, or is guessing high.
/// The settings UI can use this to say so rather than implying precision.
pub fn is_known_model(model: &str) -> bool {
    lookup(EMBEDDING_PRICES, model).is_some() || lookup(CHAT_PRICES, model).is_some()
}

pub fn embedding_cost_usd(model: &str, tokens: u64) -> f64 {
    let per_million = lookup(EMBEDDING_PRICES, model).unwrap_or(UNKNOWN_EMBEDDING_PER_MILLION);
    (tokens as f64) * per_million / 1_000_000.0
}

pub fn chat_cost_usd(model: &str, tokens_in: u64, tokens_out: u64) -> f64 {
    let p = lookup(CHAT_PRICES, model).unwrap_or(UNKNOWN_CHAT);
    (tokens_in as f64 * p.input_per_million + tokens_out as f64 * p.output_per_million)
        / 1_000_000.0
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn embedding_rate_matches_the_published_price() {
        // 1M tokens of text-embedding-3-small is $0.02.
        let c = embedding_cost_usd("openai/text-embedding-3-small", 1_000_000);
        assert!((c - 0.02).abs() < 1e-9, "got {c}");
    }

    #[test]
    fn embedding_rate_scales_linearly() {
        let c = embedding_cost_usd("openai/text-embedding-3-small", 1250);
        assert!((c - 0.000_025).abs() < 1e-12, "got {c}");
    }

    #[test]
    fn a_dearer_embedding_model_costs_more() {
        // The regression this exists to prevent: switching models used to leave
        // the ledger quoting the cheap rate.
        let small = embedding_cost_usd("openai/text-embedding-3-small", 1_000_000);
        let large = embedding_cost_usd("openai/text-embedding-3-large", 1_000_000);
        assert!(large > small, "{large} should exceed {small}");
    }

    #[test]
    fn chat_rate_counts_input_and_output_separately() {
        let c = chat_cost_usd("openai/gpt-4o-mini", 1_000_000, 0);
        assert!((c - 0.15).abs() < 1e-9, "got {c}");
        let c = chat_cost_usd("openai/gpt-4o-mini", 0, 1_000_000);
        assert!((c - 0.60).abs() < 1e-9, "got {c}");
    }

    #[test]
    fn an_unknown_model_is_priced_high_not_cheap() {
        // Erring high costs the user a "raise the budget" decision. Erring low
        // costs them money they never agreed to spend.
        let known = chat_cost_usd("openai/gpt-4o-mini", 1_000_000, 1_000_000);
        let unknown = chat_cost_usd("some/model-nobody-listed", 1_000_000, 1_000_000);
        assert!(unknown > known, "{unknown} should exceed {known}");

        let known = embedding_cost_usd("openai/text-embedding-3-small", 1_000_000);
        let unknown = embedding_cost_usd("some/embedder", 1_000_000);
        assert!(unknown > known);
    }

    #[test]
    fn model_names_match_case_insensitively() {
        assert_eq!(
            chat_cost_usd("OpenAI/GPT-4o-Mini", 1_000, 1_000),
            chat_cost_usd("openai/gpt-4o-mini", 1_000, 1_000)
        );
    }

    #[test]
    fn known_models_are_reported_as_known() {
        assert!(is_known_model("openai/gpt-4o-mini"));
        assert!(is_known_model("openai/text-embedding-3-small"));
        assert!(!is_known_model("some/model-nobody-listed"));
    }

    #[test]
    fn zero_tokens_cost_nothing() {
        assert_eq!(embedding_cost_usd("openai/text-embedding-3-small", 0), 0.0);
        assert_eq!(chat_cost_usd("openai/gpt-4o-mini", 0, 0), 0.0);
    }
}
