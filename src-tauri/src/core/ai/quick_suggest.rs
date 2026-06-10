//! Live "where does this quick note belong" ranking.
//!
//! Shared by two consumers with different cadences:
//!   - the `quick_note_filing` detector (daily run, takes the top-1 hit),
//!   - the in-editor suggestion bar (`quick_note_suggest`, fires right
//!     after a quick note is saved and shows the top few).
//!
//! Rides the embedding index via `find_related` — no OpenRouter calls in
//! here; callers that need a fresh note indexed do that first.

use std::collections::HashSet;

use anyhow::Result;
use serde::Serialize;

use super::insights::detectors::util::{base_name, similarity};
use super::related::find_related;
use super::store::AiStore;
use crate::core::quick_filing::is_quick_path;

/// Neighbours fetched from the vector index before target filtering.
const K: usize = 8;

#[derive(Debug, Clone, Serialize)]
pub struct TargetHit {
    pub note_path: String,
    /// 0.0-1.0, higher is more similar.
    pub similarity: f32,
}

/// Lowercased base names of every wikilink target in `body` (heading
/// anchors stripped) — the same comparison `util::links_to` makes, computed
/// once instead of re-parsing the note for every neighbour.
pub fn wikilink_basenames(body: &str) -> HashSet<String> {
    crate::core::parser::parse_note(body)
        .wikilinks
        .iter()
        .map(|wl| {
            let t = wl.target.split('#').next().unwrap_or(&wl.target);
            base_name(t).to_lowercase()
        })
        .collect()
}

/// One ranked candidate enriched with a snippet for the LLM prompt.
pub struct CandidateContext {
    pub note_path: String,
    pub similarity: f32,
    pub snippet: String,
}

/// What the LLM decided about a quick note. Every field is optional —
/// the caller falls back to pure-embedding behavior for anything missing.
#[derive(Debug, Default, Clone)]
pub struct LlmAdvice {
    pub title: Option<String>,
    /// Exact path from the candidate list, validated by the caller.
    pub target: Option<String>,
    /// `(folder, name)` for a brand-new note when nothing in the vault fits.
    pub new_note: Option<(String, String)>,
    pub reason: Option<String>,
}

/// System prompt for the filing call. The reply contract is strict JSON so
/// `parse_advice` stays a parser, not an NLP exercise.
pub const FILING_SYSTEM_PROMPT: &str = "You are the filing assistant inside Mycel, \
a local-first markdown knowledge base. The user just captured a quick note; decide \
where it belongs. Reply with ONLY one JSON object, no prose, with these keys: \
\"title\": a short human title for the note, in the note's own language; \
\"target\": the exact path of the ONE candidate note the quick note should be merged \
into, or null if none truly fits; \"new_note\": {\"folder\": one of the listed \
folders or \"\" for the vault root, \"name\": a short note name} when the note starts \
a topic the vault doesn't cover yet (otherwise null); \"reason\": one short sentence, \
in the note's language, explaining the choice. Never invent target paths; prefer \
\"target\" over \"new_note\" when a candidate clearly covers the topic.";

/// User prompt: the note plus everything the model may pick from.
pub fn filing_user_prompt(
    body: &str,
    candidates: &[CandidateContext],
    folders: &[String],
) -> String {
    let mut out = String::new();
    out.push_str("QUICK NOTE:\n");
    out.push_str(&body.chars().take(1500).collect::<String>());
    out.push_str("\n\nCANDIDATE NOTES:\n");
    if candidates.is_empty() {
        out.push_str("(none)\n");
    }
    for c in candidates {
        out.push_str(&format!(
            "- {} ({}% similar): {}\n",
            c.note_path,
            (c.similarity * 100.0).round() as u32,
            c.snippet.chars().take(240).collect::<String>().replace('\n', " "),
        ));
    }
    out.push_str("\nFOLDERS:\n");
    if folders.is_empty() {
        out.push_str("(vault root only)\n");
    }
    for f in folders {
        out.push_str(&format!("- {f}\n"));
    }
    out
}

/// Pull the advice out of a chat reply. Tolerant of fenced code blocks and
/// stray prose around the JSON object; intolerant of made-up shapes —
/// anything unparseable comes back as `None` and the caller falls back.
pub fn parse_advice(content: &str) -> Option<LlmAdvice> {
    let start = content.find('{')?;
    let end = content.rfind('}')?;
    let v: serde_json::Value = serde_json::from_str(&content[start..=end]).ok()?;
    let str_field = |key: &str| {
        v.get(key)
            .and_then(|s| s.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(String::from)
    };
    let new_note = v.get("new_note").and_then(|n| {
        let name = n.get("name")?.as_str()?.trim();
        if name.is_empty() {
            return None;
        }
        let folder = n
            .get("folder")
            .and_then(|f| f.as_str())
            .unwrap_or("")
            .trim()
            .trim_matches('/')
            .to_string();
        Some((folder, name.to_string()))
    });
    Some(LlmAdvice {
        title: str_field("title"),
        target: str_field("target"),
        new_note,
        reason: str_field("reason"),
    })
}

/// Chat pricing used for the budget ledger: a cheap-tier model with
/// generous headroom (USD per million tokens, in/out). Close enough for a
/// spend ceiling; the ledger is a brake, not an invoice.
pub fn chat_cost_usd(tokens_in: u64, tokens_out: u64) -> f64 {
    (tokens_in as f64 * 0.60 + tokens_out as f64 * 2.40) / 1_000_000.0
}

/// Worst-case cost estimate for one filing chat call, used for the budget
/// gate before the request goes out.
pub fn est_chat_cost_usd(prompt_chars: usize) -> f64 {
    chat_cost_usd((prompt_chars / 4).max(1) as u64, 500)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_advice_handles_fenced_json_and_nulls() {
        let reply = "Sure!\n```json\n{\"title\": \"Обрезка яблонь\", \"target\": null, \
                     \"new_note\": {\"folder\": \"Projects\", \"name\": \"Сад\"}, \
                     \"reason\": \"Новая тема\"}\n```";
        let advice = parse_advice(reply).unwrap();
        assert_eq!(advice.title.as_deref(), Some("Обрезка яблонь"));
        assert_eq!(advice.target, None);
        assert_eq!(advice.new_note, Some(("Projects".into(), "Сад".into())));
        assert_eq!(advice.reason.as_deref(), Some("Новая тема"));
    }

    #[test]
    fn parse_advice_rejects_garbage_and_empty_strings() {
        assert!(parse_advice("no json here").is_none());
        let advice = parse_advice("{\"title\": \"\", \"target\": \"a.md\"}").unwrap();
        assert_eq!(advice.title, None, "empty strings are treated as absent");
        assert_eq!(advice.target.as_deref(), Some("a.md"));
        assert_eq!(advice.new_note, None);
    }

    #[test]
    fn user_prompt_lists_candidates_and_folders() {
        let cands = vec![CandidateContext {
            note_path: "garden.md".into(),
            similarity: 0.83,
            snippet: "pruning apple trees\nin spring".into(),
        }];
        let prompt = filing_user_prompt("обрезать яблони", &cands, &["Projects".into()]);
        assert!(prompt.contains("garden.md (83% similar): pruning apple trees in spring"));
        assert!(prompt.contains("- Projects"));
        assert!(prompt.contains("обрезать яблони"));
    }
}

/// Best merge targets for one quick note, strongest first, at most `max`.
/// Other quick notes, non-`.md` targets, anything under the similarity
/// threshold, and targets the note already wikilinks to are never returned.
pub fn rank_targets(
    store: &AiStore,
    quick_path: &str,
    body: &str,
    min_similarity: f32,
    max: usize,
) -> Result<Vec<TargetHit>> {
    let linked = wikilink_basenames(body);
    let hits = find_related(store, quick_path, K)?;
    let mut out = Vec::new();
    for hit in hits {
        if is_quick_path(&hit.note_path) || !hit.note_path.ends_with(".md") {
            continue;
        }
        let sim = similarity(hit.distance);
        if sim < min_similarity {
            // Hits arrive ordered by distance: everything after is weaker.
            break;
        }
        if linked.contains(&base_name(&hit.note_path).to_lowercase()) {
            continue;
        }
        out.push(TargetHit {
            note_path: hit.note_path,
            similarity: sim,
        });
        if out.len() >= max {
            break;
        }
    }
    Ok(out)
}
