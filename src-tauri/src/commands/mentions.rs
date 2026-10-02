//! Unlinked mentions of the active note, and turning them into links.
//!
//! The matching rules live in `core::mentions`; this layer decides which
//! notes to look at and does the file I/O. Candidates come from the
//! full-text index (one phrase per name), so a lookup costs an FTS query
//! plus reading the handful of notes that might mention the target —
//! not a parse of the whole vault on every note switch.
//!
//! Encrypted notes take no part as sources: they are not in the index, and
//! rewriting one would need the vault unlocked. An encrypted *target* is
//! fine — its names are read when the vault is unlocked, and its stem is
//! always known.

use std::path::Path;

use crate::commands::fulltext::{fts_index, fts_touch};
use crate::commands::search::read_note;
use crate::core::crypto::Session;
use crate::core::fts::FtsIndex;
use crate::core::links::{note_stem, real_note_names};
use crate::core::mentions::{
    find_mentions, link_all, link_one, mention_names, MentionHit, TargetKeys,
};
use crate::core::parser::parse_note;
use crate::core::vault::{is_safe_rel_path, note_paths};
use crate::AppState;
use serde::Serialize;
use tauri::State;

/// Ceiling on notes pulled from the index per lookup. A name common enough
/// to hit more notes than this is a word, not a note worth linking from
/// everywhere, and the panel would be unreadable anyway.
const MAX_CANDIDATES: usize = 500;

#[derive(Debug, Serialize, PartialEq)]
pub struct MentionNote {
    pub path: String,
    pub title: String,
    /// Vault-relative parent folder; empty for the vault root.
    pub folder: String,
    pub hits: Vec<MentionHit>,
}

/// Everything about the target note the search and the rewrite need.
#[derive(Debug, Clone)]
pub struct TargetInfo {
    pub rel: String,
    /// Names to look for in text (title, stem, aliases).
    pub names: Vec<String>,
    /// Names a wikilink may use to reach the note.
    pub keys: TargetKeys,
    /// What goes between `[[` and `]]`: the file stem, or the extension-less
    /// path when another note shares the stem — a bare stem would then reach
    /// whichever of the two the resolver happens to meet first.
    pub link_name: String,
}

pub fn target_info(root: &Path, rel: &str, session: &Session) -> TargetInfo {
    let stem = note_stem(rel).to_string();
    let meta = read_note(root, rel, session).map(|c| parse_note(&c).meta);
    let title = meta
        .as_ref()
        .and_then(|m| m.title.clone())
        .filter(|t| !t.trim().is_empty())
        .unwrap_or_else(|| stem.clone());
    let aliases = meta.map(|m| m.aliases).unwrap_or_default();

    let paths = note_paths(root);
    let others: Vec<&str> = paths
        .iter()
        .map(String::as_str)
        .filter(|p| *p != rel)
        .collect();
    let real_names = real_note_names(others.iter().copied());
    // An alias another note is actually called belongs to that note; looking
    // for it here would offer links that point the reader somewhere else.
    let own_aliases: Vec<String> = aliases
        .iter()
        .filter(|a| !real_names.contains(&a.trim().to_lowercase()))
        .cloned()
        .collect();

    let stem_lc = stem.to_lowercase();
    let stem_shared = others
        .iter()
        .any(|p| note_stem(p).to_lowercase() == stem_lc);
    let link_name = if stem_shared {
        rel.strip_suffix(".md.age")
            .or_else(|| rel.strip_suffix(".md"))
            .unwrap_or(rel)
            .to_string()
    } else {
        stem.clone()
    };

    TargetInfo {
        rel: rel.to_string(),
        names: mention_names(&title, &stem, &own_aliases),
        keys: TargetKeys::new(rel, &title, &own_aliases, &real_names),
        link_name,
    }
}

/// Notes that mention `target` in plain text and do not already link to it,
/// sorted by title. `idx` must already be in sync with the vault.
pub fn find_unlinked_mentions(
    root: &Path,
    target: &TargetInfo,
    idx: &FtsIndex,
) -> anyhow::Result<Vec<MentionNote>> {
    if target.names.is_empty() {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    for rel in idx.paths_with_any_phrase(&target.names, MAX_CANDIDATES)? {
        if rel == target.rel || rel.ends_with(".md.age") {
            continue;
        }
        let Ok(content) = std::fs::read_to_string(root.join(&rel)) else {
            continue;
        };
        let parsed = parse_note(&content);
        // Already linked (embeds included, as in backlinks): the connection
        // exists, and listing its remaining plain mentions would nag about
        // every repeat of a name in a note that already points at it.
        if parsed
            .wikilinks
            .iter()
            .any(|wl| target.keys.is_linked_by(&wl.target))
        {
            continue;
        }
        let hits = find_mentions(&content, &target.names);
        if hits.is_empty() {
            continue;
        }
        let title = parsed
            .meta
            .title
            .filter(|t| !t.trim().is_empty())
            .unwrap_or_else(|| note_stem(&rel).to_string());
        let folder = Path::new(&rel)
            .parent()
            .map(|p| p.to_string_lossy().replace('\\', "/"))
            .unwrap_or_default();
        out.push(MentionNote {
            path: rel,
            title,
            folder,
            hits,
        });
    }
    out.sort_by(|a, b| {
        a.title
            .to_lowercase()
            .cmp(&b.title.to_lowercase())
            .then_with(|| a.path.cmp(&b.path))
    });
    Ok(out)
}

/// The note a mention may be linked in: a plaintext note inside the vault.
fn check_source(source: &str) -> Result<(), String> {
    if !is_safe_rel_path(source) {
        return Err("Invalid note path".into());
    }
    if !source.ends_with(".md") {
        return Err("Only plaintext notes can be linked from here".into());
    }
    Ok(())
}

/// Rewrite one mention in `source` into a link to `target`. Re-reads the
/// file and refuses when the occurrence is no longer where and what the
/// caller saw.
pub fn link_mention_in_file(
    root: &Path,
    source: &str,
    target: &TargetInfo,
    line: usize,
    col: usize,
    text: &str,
) -> Result<(), String> {
    check_source(source)?;
    let abs = root.join(source);
    let content =
        std::fs::read_to_string(&abs).map_err(|e| format!("Failed to read {source}: {e}"))?;
    let next = link_one(&content, &target.names, &target.link_name, line, col, text)
        .map_err(|e| e.to_string())?;
    std::fs::write(&abs, next).map_err(|e| format!("Failed to write {source}: {e}"))
}

/// Link every mention of `target` in `source`; returns how many.
pub fn link_all_in_file(root: &Path, source: &str, target: &TargetInfo) -> Result<usize, String> {
    check_source(source)?;
    let abs = root.join(source);
    let content =
        std::fs::read_to_string(&abs).map_err(|e| format!("Failed to read {source}: {e}"))?;
    let (next, n) = link_all(&content, &target.names, &target.link_name);
    if n > 0 {
        std::fs::write(&abs, next).map_err(|e| format!("Failed to write {source}: {e}"))?;
    }
    Ok(n)
}

async fn vault_root(state: &State<'_, AppState>) -> Result<std::path::PathBuf, String> {
    let guard = state.vault.lock().await;
    guard
        .as_ref()
        .map(|v| v.root.clone())
        .ok_or_else(|| "No vault open".to_string())
}

#[tauri::command]
pub async fn mentions_unlinked(
    path: String,
    state: State<'_, AppState>,
) -> Result<Vec<MentionNote>, String> {
    if !is_safe_rel_path(&path) {
        return Err("Invalid note path".into());
    }
    let root = vault_root(&state).await?;
    let idx = fts_index(&state, &root)?;
    let session = state.crypto.clone();
    // Index queries and file reads are blocking; keep them off the runtime.
    tokio::task::spawn_blocking(move || {
        idx.ensure_synced()?;
        let target = target_info(&root, &path, &session);
        find_unlinked_mentions(&root, &target, &idx)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub async fn mention_link(
    source: String,
    target: String,
    line: usize,
    col: usize,
    text: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if !is_safe_rel_path(&target) {
        return Err("Invalid note path".into());
    }
    let root = vault_root(&state).await?;
    let info = target_info(&root, &target, &state.crypto);
    link_mention_in_file(&root, &source, &info, line, col, &text)?;
    fts_touch(&state, &root, &[&source]);
    Ok(())
}

#[tauri::command]
pub async fn mention_link_all(
    source: String,
    target: String,
    state: State<'_, AppState>,
) -> Result<usize, String> {
    if !is_safe_rel_path(&target) {
        return Err("Invalid note path".into());
    }
    let root = vault_root(&state).await?;
    let info = target_info(&root, &target, &state.crypto);
    let n = link_all_in_file(&root, &source, &info)?;
    if n > 0 {
        fts_touch(&state, &root, &[&source]);
    }
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write(root: &Path, rel: &str, body: &str) {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, body).unwrap();
    }

    fn setup(files: &[(&str, &str)]) -> (TempDir, FtsIndex) {
        let dir = TempDir::new().unwrap();
        for (rel, body) in files {
            write(dir.path(), rel, body);
        }
        let idx = FtsIndex::open_in_memory(dir.path()).unwrap();
        idx.sync().unwrap();
        (dir, idx)
    }

    fn found(root: &Path, idx: &FtsIndex, target: &str) -> Vec<(String, Vec<String>)> {
        let info = target_info(root, target, &Session::default());
        find_unlinked_mentions(root, &info, idx)
            .unwrap()
            .into_iter()
            .map(|n| (n.path, n.hits.into_iter().map(|h| h.text).collect()))
            .collect()
    }

    #[test]
    fn finds_plain_mentions_and_skips_linked_notes_and_the_target() {
        let (d, idx) = setup(&[
            (
                "Огород.md",
                "---\naliases: [грядки]\n---\nОгород упоминает сам себя",
            ),
            ("a.md", "Сегодня копал огород и полол Грядки."),
            ("b.md", "Про [[Огород]] и ещё раз огород"),
            ("c.md", "Ссылка через алиас [[грядки]], и огород"),
            ("d.md", "огородник и `огород` в коде"),
            ("e.md", "Встроено ![[Огород]], огород"),
            ("f.md.age", "огород"),
        ]);
        let got = found(d.path(), &idx, "Огород.md");
        assert_eq!(
            got,
            vec![(
                "a.md".to_string(),
                vec!["огород".to_string(), "Грядки".to_string()]
            )]
        );
    }

    #[test]
    fn title_and_stem_both_count_and_results_sort_by_title() {
        let (d, idx) = setup(&[
            ("ml.md", "---\ntitle: Machine Learning\n---\n"),
            (
                "z.md",
                "---\ntitle: Alpha\n---\nI study machine learning (ML).",
            ),
            (
                "y.md",
                "---\ntitle: Beta\n---\nSee ml.md? No: just ml, here.",
            ),
        ]);
        // `ml` is too short to search for on its own; the title still is.
        let got = found(d.path(), &idx, "ml.md");
        assert_eq!(got, vec![("z.md".into(), vec!["machine learning".into()])]);
    }

    #[test]
    fn an_alias_that_is_another_notes_name_is_not_searched() {
        let (d, idx) = setup(&[
            ("Garden.md", "---\naliases: [Rust]\n---\n"),
            ("Rust.md", "x"),
            ("a.md", "Rust and the Garden"),
        ]);
        let got = found(d.path(), &idx, "Garden.md");
        assert_eq!(got, vec![("a.md".into(), vec!["Garden".into()])]);
    }

    #[test]
    fn link_name_is_path_qualified_when_the_stem_is_shared() {
        let (d, _idx) = setup(&[("a/Plan.md", ""), ("b/plan.md", ""), ("Solo.md", "")]);
        let s = Session::default();
        assert_eq!(target_info(d.path(), "a/Plan.md", &s).link_name, "a/Plan");
        assert_eq!(target_info(d.path(), "Solo.md", &s).link_name, "Solo");
    }

    #[test]
    fn linking_one_mention_rewrites_the_file_and_refuses_stale_ones() {
        let (d, idx) = setup(&[
            ("Garden plan.md", "---\naliases: [огород]\n---\n"),
            ("n.md", "A garden plan, then the Огород.\n"),
        ]);
        let root = d.path();
        let info = target_info(root, "Garden plan.md", &Session::default());
        let notes = find_unlinked_mentions(root, &info, &idx).unwrap();
        let hits = &notes[0].hits;
        assert_eq!(hits.len(), 2);

        link_mention_in_file(
            root,
            "n.md",
            &info,
            hits[1].line,
            hits[1].col,
            &hits[1].text,
        )
        .unwrap();
        assert_eq!(
            std::fs::read_to_string(root.join("n.md")).unwrap(),
            "A garden plan, then the [[Garden plan|Огород]].\n"
        );

        // The first hit's offsets are still valid, but replaying the second
        // one is not: that text is a link now.
        let err = link_mention_in_file(
            root,
            "n.md",
            &info,
            hits[1].line,
            hits[1].col,
            &hits[1].text,
        );
        assert!(err.is_err());
        link_mention_in_file(
            root,
            "n.md",
            &info,
            hits[0].line,
            hits[0].col,
            &hits[0].text,
        )
        .unwrap();
        assert_eq!(
            std::fs::read_to_string(root.join("n.md")).unwrap(),
            "A [[Garden plan|garden plan]], then the [[Garden plan|Огород]].\n"
        );
    }

    #[test]
    fn link_all_and_the_index_agree_afterwards() {
        let (d, idx) = setup(&[
            ("Сад.md", ""),
            ("n.md", "Сад, сад и [ссылка](сад.md)\nещё сад"),
        ]);
        let root = d.path();
        let info = target_info(root, "Сад.md", &Session::default());
        assert_eq!(link_all_in_file(root, "n.md", &info).unwrap(), 3);
        assert_eq!(
            std::fs::read_to_string(root.join("n.md")).unwrap(),
            "[[Сад]], [[Сад|сад]] и [ссылка](сад.md)\nещё [[Сад|сад]]"
        );
        idx.update_path("n.md").unwrap();
        assert!(find_unlinked_mentions(root, &info, &idx)
            .unwrap()
            .is_empty());
        assert_eq!(link_all_in_file(root, "n.md", &info).unwrap(), 0);
    }

    #[test]
    fn sources_must_be_plaintext_notes_inside_the_vault() {
        let (d, _idx) = setup(&[("Сад.md", "")]);
        let info = target_info(d.path(), "Сад.md", &Session::default());
        assert!(link_all_in_file(d.path(), "../x.md", &info).is_err());
        assert!(link_all_in_file(d.path(), "x.md.age", &info).is_err());
        assert!(link_mention_in_file(d.path(), "/abs.md", &info, 1, 0, "Сад").is_err());
    }
}
