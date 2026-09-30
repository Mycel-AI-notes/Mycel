//! Embedder abstraction used by the indexer.
//!
//! The indexer's job is "given chunks, produce vectors and record usage."
//! `Embedder` lets us swap the real OpenRouter client for a deterministic
//! stub in tests, and (eventually) a local-model implementation without
//! touching the indexer.

use anyhow::Result;
use async_trait::async_trait;

use super::openrouter::{OpenRouterClient, ReqwestTransport};
use super::store::EMBED_DIM;

#[derive(Debug, Clone)]
pub struct EmbedBatch {
    pub vectors: Vec<Vec<f32>>,
    pub tokens_in: u64,
}

#[async_trait]
pub trait Embedder: Send + Sync {
    async fn embed(&self, inputs: &[String]) -> Result<EmbedBatch>;

    /// Dimensionality of every vector returned. Indexers use this to sanity-
    /// check before writing into the vec0 table.
    fn dim(&self) -> usize;
}

/// Production embedder: OpenRouter over reqwest.
pub struct OpenRouterEmbedder {
    client: OpenRouterClient<ReqwestTransport>,
    api_key: String,
    model: String,
}

impl OpenRouterEmbedder {
    pub fn new(api_key: String, model: String) -> Self {
        Self {
            client: OpenRouterClient::new(),
            api_key,
            model,
        }
    }
}

#[async_trait]
impl Embedder for OpenRouterEmbedder {
    async fn embed(&self, inputs: &[String]) -> Result<EmbedBatch> {
        let resp = self
            .client
            .embed(&self.api_key, &self.model, inputs)
            .await?;
        let tokens_in = if resp.usage.prompt_tokens > 0 {
            resp.usage.prompt_tokens
        } else {
            // OpenRouter occasionally returns 0 if the upstream provider
            // doesn't report usage. Fall back to a 1-token-per-4-chars
            // estimate so the budget tracker still moves and doesn't
            // silently drift.
            inputs.iter().map(|s| (s.chars().count() / 4) as u64).sum()
        };
        Ok(EmbedBatch {
            vectors: resp.data.into_iter().map(|d| d.embedding).collect(),
            tokens_in,
        })
    }

    fn dim(&self) -> usize {
        EMBED_DIM
    }
}

/// USD cost of embedding `tokens` with `model`. See `super::pricing` — the
/// rate has to follow the configured model, which this used to ignore.
pub fn estimate_cost_usd(model: &str, tokens: u64) -> f64 {
    super::pricing::embedding_cost_usd(model, tokens)
}

#[cfg(test)]
pub mod testing {
    //! Deterministic in-memory embedder for tests. Maps each chunk to a
    //! vector derived from its char distribution, so two equal chunks
    //! always get the same vector and two different chunks (almost
    //! always) get different vectors.

    use super::*;
    use std::sync::Mutex;

    pub struct StubEmbedder {
        pub dim: usize,
        pub calls: Mutex<Vec<Vec<String>>>,
        pub fail_next: Mutex<bool>,
    }

    impl StubEmbedder {
        pub fn new(dim: usize) -> Self {
            Self {
                dim,
                calls: Mutex::new(Vec::new()),
                fail_next: Mutex::new(false),
            }
        }
    }

    #[async_trait]
    impl Embedder for StubEmbedder {
        async fn embed(&self, inputs: &[String]) -> Result<EmbedBatch> {
            if std::mem::replace(&mut *self.fail_next.lock().unwrap(), false) {
                anyhow::bail!("stub embedder: forced failure");
            }
            self.calls.lock().unwrap().push(inputs.to_vec());
            let vectors = inputs
                .iter()
                .map(|s| {
                    let mut v = vec![0.0_f32; self.dim];
                    // Sprinkle char codes across slots to make distinct
                    // strings map to distinct vectors. Bounded by dim so
                    // long inputs don't overflow.
                    for (i, ch) in s.chars().enumerate() {
                        v[i % self.dim] += (ch as u32 as f32) / 1000.0;
                    }
                    v
                })
                .collect();
            // Fake but plausible token count so budget tests have something
            // to assert on.
            let tokens_in = inputs.iter().map(|s| (s.chars().count() / 4) as u64).sum();
            Ok(EmbedBatch { vectors, tokens_in })
        }

        fn dim(&self) -> usize {
            self.dim
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cost_estimate_matches_pricing_table() {
        // 1M tokens of the default embedding model → $0.02
        let c = estimate_cost_usd(EMBED_MODEL_DEFAULT, 1_000_000);
        assert!((c - 0.02).abs() < 1e-9);
    }

    #[test]
    fn small_token_count_costs_pennies() {
        // ~5000 chars / 4 ≈ 1250 tokens → $0.000025
        let c = estimate_cost_usd(EMBED_MODEL_DEFAULT, 1250);
        assert!(c < 0.0001);
    }

    #[test]
    fn cost_follows_the_configured_model() {
        // The point of routing through the pricing table: this used to quote
        // the cheap rate no matter which model was configured.
        let cheap = estimate_cost_usd(EMBED_MODEL_DEFAULT, 1_000_000);
        let dear = estimate_cost_usd("openai/text-embedding-3-large", 1_000_000);
        assert!(dear > cheap, "{dear} should exceed {cheap}");
    }

    const EMBED_MODEL_DEFAULT: &str = "openai/text-embedding-3-small";
}
