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
