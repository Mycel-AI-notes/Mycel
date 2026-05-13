//! OpenRouter embeddings client.
//!
//! Endpoint: POST https://openrouter.ai/api/v1/embeddings
//!
//! Why an HTTP indirection trait: the embed loop is a tiny piece of business
//! logic (batching, retry, usage accounting) and we want to test it without
//! either a real key or a real network. `HttpTransport` is what the prod
//! client implements over reqwest; tests pass `MockTransport`.

use anyhow::{anyhow, Context, Result};
use async_trait::async_trait;
use serde::{Deserialize, Serialize};

const DEFAULT_BASE_URL: &str = "https://openrouter.ai/api/v1";
const REFERER: &str = "https://mycel.app";
const TITLE: &str = "Mycel";

/// OpenAI-compatible embeddings response. OpenRouter proxies upstream
/// providers and returns the same shape regardless of which one served us.
#[derive(Debug, Clone, Deserialize)]
pub struct EmbedResponse {
    pub data: Vec<EmbedDatum>,
    #[serde(default)]
    pub usage: Usage,
    #[serde(default)]
    pub model: String,
}

#[derive(Debug, Clone, Deserialize)]
pub struct EmbedDatum {
    pub embedding: Vec<f32>,
    #[serde(default)]
    pub index: usize,
}

#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct Usage {
    #[serde(default)]
    pub prompt_tokens: u64,
    #[serde(default)]
    pub total_tokens: u64,
}

#[derive(Debug, Clone, Serialize)]
struct EmbedRequest<'a> {
    model: &'a str,
    input: &'a [String],
}

/// Abstracts the actual HTTP call. Real code uses `ReqwestTransport`; tests
/// inject a `MockTransport` that returns canned responses.
#[async_trait]
pub trait HttpTransport: Send + Sync {
    async fn post_json(
        &self,
        url: &str,
        bearer: &str,
        body: serde_json::Value,
    ) -> Result<HttpResponse>;
}

#[derive(Debug)]
pub struct HttpResponse {
    pub status: u16,
    pub body: String,
}

pub struct ReqwestTransport {
    client: reqwest::Client,
}

impl ReqwestTransport {
    pub fn new() -> Self {
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .expect("reqwest client must build");
        Self { client }
    }
}

impl Default for ReqwestTransport {
    fn default() -> Self {
        Self::new()
    }
}

#[async_trait]
impl HttpTransport for ReqwestTransport {
    async fn post_json(
        &self,
        url: &str,
        bearer: &str,
        body: serde_json::Value,
    ) -> Result<HttpResponse> {
        let resp = self
            .client
            .post(url)
            .bearer_auth(bearer)
            // OpenRouter requires these for attribution / rate-limit tiers.
            .header("HTTP-Referer", REFERER)
            .header("X-Title", TITLE)
            .json(&body)
            .send()
            .await
            .context("OpenRouter request failed")?;
        let status = resp.status().as_u16();
        let body = resp.text().await.context("OpenRouter response body")?;
        Ok(HttpResponse { status, body })
    }
}

pub struct OpenRouterClient<T: HttpTransport> {
    transport: T,
    base_url: String,
}

impl OpenRouterClient<ReqwestTransport> {
    pub fn new() -> Self {
        Self {
            transport: ReqwestTransport::new(),
            base_url: DEFAULT_BASE_URL.to_string(),
        }
    }
}

impl Default for OpenRouterClient<ReqwestTransport> {
    fn default() -> Self {
        Self::new()
    }
}

impl<T: HttpTransport> OpenRouterClient<T> {
    pub fn with_transport(transport: T) -> Self {
        Self {
            transport,
            base_url: DEFAULT_BASE_URL.to_string(),
        }
    }

    #[cfg(test)]
    pub fn with_base_url(mut self, base_url: impl Into<String>) -> Self {
        self.base_url = base_url.into();
        self
    }

    /// Single round-trip embed call. Caller is responsible for batching
    /// inputs to a reasonable size — MVP-2's indexer chunks at 100 per call.
    pub async fn embed(
        &self,
        api_key: &str,
        model: &str,
        inputs: &[String],
    ) -> Result<EmbedResponse> {
        let url = format!("{}/embeddings", self.base_url);
        let req = EmbedRequest { model, input: inputs };
        let body = serde_json::to_value(&req)?;
        let resp = self.transport.post_json(&url, api_key, body).await?;
        parse_response(resp.status, &resp.body, inputs.len())
    }

    /// Cheapest possible call that proves the key is valid. We embed a
    /// single token's worth of text so the user's "Test" button doesn't
    /// burn meaningful credits. Returns the model echoed by OpenRouter on
    /// success, which the UI surfaces as "✓ connected (<model>)".
    pub async fn test_key(&self, api_key: &str, model: &str) -> Result<String> {
        let resp = self.embed(api_key, model, &["ping".to_string()]).await?;
        Ok(if resp.model.is_empty() {
            model.to_string()
        } else {
            resp.model
        })
    }
}

/// Pure parser: extracted from `embed` so unit tests can hit it directly.
fn parse_response(status: u16, body: &str, expected_count: usize) -> Result<EmbedResponse> {
    if !(200..300).contains(&status) {
        // Try to extract OpenAI/OpenRouter's structured error before falling
        // back to the raw body — a 401 with `{"error":{"message":"No auth"}}`
        // should surface "No auth", not the full JSON.
        if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(body) {
            if let Some(msg) = parsed
                .get("error")
                .and_then(|e| e.get("message"))
                .and_then(|m| m.as_str())
            {
                return Err(anyhow!("OpenRouter {}: {}", status, msg));
            }
        }
        return Err(anyhow!("OpenRouter {}: {}", status, truncate(body, 200)));
    }
    let parsed: EmbedResponse = serde_json::from_str(body)
        .with_context(|| format!("Failed to parse OpenRouter response: {}", truncate(body, 200)))?;
    if parsed.data.len() != expected_count {
        return Err(anyhow!(
            "OpenRouter returned {} embeddings, expected {}",
            parsed.data.len(),
            expected_count
        ));
    }
    Ok(parsed)
}

fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        format!("{}…", &s[..max])
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    struct MockTransport {
        responses: Mutex<Vec<HttpResponse>>,
        last_call: Mutex<Option<(String, String, serde_json::Value)>>,
    }

    impl MockTransport {
        fn with_responses(responses: Vec<HttpResponse>) -> Self {
            Self {
                responses: Mutex::new(responses),
                last_call: Mutex::new(None),
            }
        }
    }

    #[async_trait]
    impl HttpTransport for MockTransport {
        async fn post_json(
            &self,
            url: &str,
            bearer: &str,
            body: serde_json::Value,
        ) -> Result<HttpResponse> {
            *self.last_call.lock().unwrap() =
                Some((url.to_string(), bearer.to_string(), body));
            self.responses
                .lock()
                .unwrap()
                .pop()
                .ok_or_else(|| anyhow!("MockTransport ran out of canned responses"))
        }
    }

    fn ok_body(n: usize) -> String {
        let data: Vec<_> = (0..n)
            .map(|i| {
                serde_json::json!({
                    "embedding": [0.1_f32, 0.2, 0.3],
                    "index": i,
                })
            })
            .collect();
        serde_json::json!({
            "model": "openai/text-embedding-3-small",
            "data": data,
            "usage": { "prompt_tokens": 3, "total_tokens": 3 },
        })
        .to_string()
    }

    #[tokio::test]
    async fn embed_happy_path() {
        let transport = MockTransport::with_responses(vec![HttpResponse {
            status: 200,
            body: ok_body(2),
        }]);
        let client = OpenRouterClient::with_transport(transport);
        let resp = client
            .embed(
                "sk-test",
                "openai/text-embedding-3-small",
                &["a".into(), "b".into()],
            )
            .await
            .unwrap();
        assert_eq!(resp.data.len(), 2);
        assert_eq!(resp.usage.total_tokens, 3);
    }

    #[tokio::test]
    async fn embed_sends_bearer_and_body() {
        let transport =
            std::sync::Arc::new(MockTransport::with_responses(vec![HttpResponse {
                status: 200,
                body: ok_body(1),
            }]));
        // Borrow the same instance through both the client and our test
        // assertion. The transport doesn't outlive the test, so a leak-free
        // wrapper isn't necessary — just share via Arc.
        struct Shared(std::sync::Arc<MockTransport>);
        #[async_trait]
        impl HttpTransport for Shared {
            async fn post_json(
                &self,
                url: &str,
                bearer: &str,
                body: serde_json::Value,
            ) -> Result<HttpResponse> {
                self.0.post_json(url, bearer, body).await
            }
        }
        let client = OpenRouterClient::with_transport(Shared(transport.clone()));
        let _ = client
            .embed("sk-test-key", "openai/text-embedding-3-small", &["hello".into()])
            .await
            .unwrap();
        let call = transport.last_call.lock().unwrap().clone().expect("called");
        assert!(call.0.ends_with("/embeddings"));
        assert_eq!(call.1, "sk-test-key");
        assert_eq!(call.2["model"], "openai/text-embedding-3-small");
        assert_eq!(call.2["input"][0], "hello");
    }

    #[tokio::test]
    async fn embed_rejects_count_mismatch() {
        let transport = MockTransport::with_responses(vec![HttpResponse {
            status: 200,
            body: ok_body(1),
        }]);
        let client = OpenRouterClient::with_transport(transport);
        let err = client
            .embed("k", "m", &["a".into(), "b".into()])
            .await
            .unwrap_err();
        assert!(err.to_string().contains("expected 2"));
    }

    #[tokio::test]
    async fn embed_surfaces_structured_error_message() {
        let transport = MockTransport::with_responses(vec![HttpResponse {
            status: 401,
            body: serde_json::json!({ "error": { "message": "Invalid API key" } })
                .to_string(),
        }]);
        let client = OpenRouterClient::with_transport(transport);
        let err = client.embed("k", "m", &["a".into()]).await.unwrap_err();
        let msg = err.to_string();
        assert!(msg.contains("401"));
        assert!(msg.contains("Invalid API key"));
    }

    #[tokio::test]
    async fn embed_falls_back_to_raw_body_on_unstructured_error() {
        let transport = MockTransport::with_responses(vec![HttpResponse {
            status: 503,
            body: "upstream timeout".to_string(),
        }]);
        let client = OpenRouterClient::with_transport(transport);
        let err = client.embed("k", "m", &["a".into()]).await.unwrap_err();
        assert!(err.to_string().contains("503"));
        assert!(err.to_string().contains("upstream timeout"));
    }

    #[tokio::test]
    async fn test_key_returns_model_name() {
        let transport = MockTransport::with_responses(vec![HttpResponse {
            status: 200,
            body: ok_body(1),
        }]);
        let client = OpenRouterClient::with_transport(transport);
        let model = client.test_key("k", "openai/text-embedding-3-small").await.unwrap();
        assert_eq!(model, "openai/text-embedding-3-small");
    }
}
