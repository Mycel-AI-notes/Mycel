//! Vault-wide lookups: the note list behind the quick switcher, backlinks,
//! and tag search.
//!
//! Each command is a thin wrapper that resolves the open vault and hands off
//! to a plain function over a vault root. That split is what makes any of this
//! testable — a `State<'_, AppState>` cannot be built in a unit test, and
//! these three carried real, untested logic: stem matching, link resolution,
//! context extraction and sort order.

use std::path::Path;

use crate::core::crypto::{decrypt_note, Session};
use crate::core::links::{alias_matches, link_key, note_stem, real_note_names};
use crate::core::parser::parse_note;
use crate::core::vault::note_paths;
use crate::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

#[derive(Debug, Serialize, Deserialize)]
pub struct NoteSummary {
    pub path: String,
    pub title: String,
    /// Frontmatter `aliases`, so the editor can resolve and autocomplete
    /// `[[alias]]` without reading every note itself. Empty for encrypted
    /// notes, whose frontmatter needs the vault unlocked.
    #[serde(default)]
    pub aliases: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Backlink {
    pub path: String,
    pub title: String,
    pub context: String,
    /// Vault-relative parent folder of the linking note. Empty string for
    /// notes in the vault root. Useful for showing "where does this live".
    pub folder: String,
}

/// Read a note's text, decrypting when it is an encrypted one and the vault is
/// unlocked. `None` when the file is unreadable or still sealed — callers skip
/// it rather than failing the whole scan, so a locked vault returns what it can.
pub(crate) fn read_note(root: &Path, rel: &str, session: &Session) -> Option<String> {
    let abs = root.join(rel);
    if rel.ends_with(".md.age") {
        std::fs::read(&abs)
            .ok()
            .and_then(|raw| decrypt_note(session, &raw).ok())
    } else {
        std::fs::read_to_string(&abs).ok()
    }
}

/// Every note in the vault with its display title, sorted by title.
///
/// An encrypted note contributes its file stem: reading the title out of the
/// frontmatter would need the vault unlocked, and the switcher has to list it
/// either way.
pub fn list_notes(root: &Path) -> Vec<NoteSummary> {
    let mut notes: Vec<NoteSummary> = note_paths(root)
        .into_iter()
        .map(|rel| {
            let stem = note_stem(&rel).to_string();
            let meta = if rel.ends_with(".md.age") {
                None
            } else {
                std::fs::read_to_string(root.join(&rel))
                    .ok()
                    .map(|content| parse_note(&content).meta)
            };
            let (title, aliases) = match meta {
                Some(m) => (m.title.unwrap_or(stem), m.aliases),
                None => (stem, Vec::new()),
            };
            NoteSummary {
                path: rel,
                title,
                aliases,
            }
        })
        .collect();
    notes.sort_by(|a, b| a.title.cmp(&b.title));
    notes
}

#[tauri::command]
pub async fn notes_list(state: State<'_, AppState>) -> Result<Vec<NoteSummary>, String> {
    let vault_root = {
        let guard = state.vault.lock().await;
        guard
            .as_ref()
            .map(|v| v.root.clone())
            .ok_or("No vault open")?
    };
    Ok(list_notes(&vault_root))
}

/// Does `wikilink_target` refer to the note whose lowercased stem is `target`?
///
/// Deliberately loose: `[[Note]]`, `[[folder/Note]]`, `[[Note.md]]` and
/// `[[Note#Heading]]` all have to match, because all four resolve to the same
/// note everywhere else in the app.
fn link_matches(wikilink_target: &str, target_stem: &str) -> bool {
    let mut t = wikilink_target.to_lowercase();
    if let Some(idx) = t.find('#') {
        t.truncate(idx);
    }
    let t = t.trim();
    let stem = Path::new(t)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| t.to_string());
    stem == target_stem
}

/// Notes that link to `path`, sorted by folder then title.
///
/// A link counts when it names the note's basename, or — failing any note
/// actually carrying that name — one of its frontmatter `aliases`. Embeds
/// (`![[Note]]`) count like links: they depend on the note just the same.
pub fn find_backlinks(root: &Path, path: &str, session: &Session) -> Vec<Backlink> {
    // `Path::file_stem` is wrong here: for `Note.md.age` it yields `Note.md`,
    // which matches no wikilink, so an encrypted note never had backlinks.
    let target_stem = note_stem(path).to_lowercase();
    let mut backlinks = Vec::new();

    let paths = note_paths(root);
    let aliases: Vec<String> = read_note(root, path, session)
        .map(|content| parse_note(&content).meta.aliases)
        .unwrap_or_default();
    let real_names = if aliases.is_empty() {
        Default::default()
    } else {
        real_note_names(paths.iter().map(String::as_str))
    };
    let links_here = |target: &str| {
        link_matches(target, &target_stem) || alias_matches(target, &aliases, &real_names)
    };
    // Lowercased `[[name` prefixes that can open a link to this note, for
    // picking the context line.
    let mut needles = vec![format!("[[{target_stem}"), format!("[[{path}")];
    for alias in &aliases {
        let key = link_key(alias);
        if !real_names.contains(&key) {
            needles.push(format!("[[{key}"));
        }
    }

    for rel in paths {
        if rel == path {
            continue;
        }
        let Some(content) = read_note(root, &rel, session) else {
            continue;
        };
        let parsed = parse_note(&content);
        if !parsed.wikilinks.iter().any(|wl| links_here(&wl.target)) {
            continue;
        }

        let title = parsed
            .meta
            .title
            .clone()
            .unwrap_or_else(|| note_stem(&rel).to_string());

        // First line mentioning the target, as a preview.
        let context: String = parsed
            .body
            .lines()
            .find(|line| {
                let lower = line.to_lowercase();
                needles.iter().any(|n| lower.contains(n.as_str()))
            })
            .unwrap_or("")
            .trim()
            .chars()
            .take(120)
            .collect();

        let folder = Path::new(&rel)
            .parent()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_default();

        backlinks.push(Backlink {
            path: rel,
            title,
            context,
            folder,
        });
    }

    backlinks.sort_by(|a, b| a.folder.cmp(&b.folder).then(a.title.cmp(&b.title)));
    backlinks
}

#[tauri::command]
pub async fn backlinks_get(
    path: String,
    state: State<'_, AppState>,
) -> Result<Vec<Backlink>, String> {
    let vault_root = {
        let guard = state.vault.lock().await;
        guard
            .as_ref()
            .map(|v| v.root.clone())
            .ok_or("No vault open")?
    };
    Ok(find_backlinks(&vault_root, &path, &state.crypto))
}

/// Notes carrying `tag`, in the body or the frontmatter, sorted by title.
/// A leading `#` is optional; an empty tag matches nothing.
pub fn find_by_tag(root: &Path, tag: &str, session: &Session) -> Vec<NoteSummary> {
    let needle = tag.trim().trim_start_matches('#').to_lowercase();
    if needle.is_empty() {
        return Vec::new();
    }

    let mut matches: Vec<NoteSummary> = Vec::new();
    for rel in note_paths(root) {
        let Some(content) = read_note(root, &rel, session) else {
            continue;
        };
        let parsed = parse_note(&content);
        let in_body = parsed.tags.iter().any(|t| t.to_lowercase() == needle);
        let in_meta = parsed.meta.tags.iter().any(|t| t.to_lowercase() == needle);
        if !in_body && !in_meta {
            continue;
        }
        let title = parsed
            .meta
            .title
            .clone()
            .unwrap_or_else(|| note_stem(&rel).to_string());
        matches.push(NoteSummary {
            path: rel,
            title,
            aliases: parsed.meta.aliases,
        });
    }
    matches.sort_by(|a, b| a.title.cmp(&b.title));
    matches
}

#[tauri::command]
pub async fn notes_by_tag(
    tag: String,
    state: State<'_, AppState>,
) -> Result<Vec<NoteSummary>, String> {
    let vault_root = {
        let guard = state.vault.lock().await;
        guard
            .as_ref()
            .map(|v| v.root.clone())
            .ok_or("No vault open")?
    };
    Ok(find_by_tag(&vault_root, &tag, &state.crypto))
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

    /// A locked vault. Plaintext notes read fine; `.md.age` files are skipped,
    /// which is the state the app is in until the user unlocks.
    fn locked() -> Session {
        Session::default()
    }

    // ---- list_notes -------------------------------------------------------

    #[test]
    fn list_notes_prefers_the_frontmatter_title() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "a.md", "---\ntitle: Real Title\n---\n\nbody");

        let notes = list_notes(root);

        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].title, "Real Title");
        assert_eq!(notes[0].path, "a.md");
    }

    #[test]
    fn list_notes_falls_back_to_the_file_stem() {
        let dir = TempDir::new().unwrap();
        write(dir.path(), "My Note.md", "no frontmatter here");

        let notes = list_notes(dir.path());

        assert_eq!(notes[0].title, "My Note");
    }

    #[test]
    fn list_notes_uses_the_stem_for_an_encrypted_note() {
        // Reading the title would need the vault unlocked, but the switcher
        // still has to list it.
        let dir = TempDir::new().unwrap();
        write(dir.path(), "Secret.md.age", "ciphertext");

        let notes = list_notes(dir.path());

        assert_eq!(notes.len(), 1);
        assert_eq!(notes[0].title, "Secret");
        assert_eq!(notes[0].path, "Secret.md.age");
    }

    #[test]
    fn list_notes_sorts_by_title_not_path() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "zzz.md", "---\ntitle: Apple\n---\n");
        write(root, "aaa.md", "---\ntitle: Banana\n---\n");

        let titles: Vec<String> = list_notes(root).into_iter().map(|n| n.title).collect();

        assert_eq!(titles, vec!["Apple", "Banana"]);
    }

    #[test]
    fn list_notes_ignores_non_notes_and_dot_directories() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "note.md", "x");
        write(root, "readme.txt", "x");
        write(root, ".git/objects/thing.md", "x");
        write(root, ".mycel/trash/2026/old.md", "x");

        let paths: Vec<String> = list_notes(root).into_iter().map(|n| n.path).collect();

        assert_eq!(paths, vec!["note.md"]);
    }

    // ---- link_matches -----------------------------------------------------

    #[test]
    fn link_matches_accepts_every_form_the_app_resolves() {
        assert!(link_matches("Note", "note"));
        assert!(link_matches("folder/Note", "note"));
        assert!(link_matches("Note.md", "note"));
        assert!(link_matches("Note#Heading", "note"));
        assert!(link_matches("  Note  ", "note"));
        assert!(link_matches("NOTE", "note"));
    }

    #[test]
    fn link_matches_rejects_a_different_note() {
        assert!(!link_matches("Notes", "note"));
        assert!(!link_matches("Other", "note"));
        assert!(!link_matches("folder/Other", "note"));
    }

    // ---- find_backlinks ---------------------------------------------------

    #[test]
    fn backlinks_finds_a_bare_link() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "target.md", "# Target");
        write(root, "source.md", "see [[target]] here");

        let links = find_backlinks(root, "target.md", &locked());

        assert_eq!(links.len(), 1);
        assert_eq!(links[0].path, "source.md");
        assert_eq!(links[0].context, "see [[target]] here");
    }

    #[test]
    fn backlinks_finds_path_alias_and_anchor_forms() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "notes/target.md", "# Target");
        write(root, "a.md", "[[notes/target]]");
        write(root, "b.md", "[[target|see this]]");
        write(root, "c.md", "[[target#Section]]");
        write(root, "d.md", "[[target.md]]");

        let links = find_backlinks(root, "notes/target.md", &locked());

        let mut paths: Vec<&str> = links.iter().map(|l| l.path.as_str()).collect();
        paths.sort();
        assert_eq!(paths, vec!["a.md", "b.md", "c.md", "d.md"]);
    }

    #[test]
    fn backlinks_count_an_embed() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "target.md", "x");
        write(root, "a.md", "![[target]]\n");

        let links = find_backlinks(root, "target.md", &locked());

        assert_eq!(links.len(), 1);
        assert_eq!(links[0].context, "![[target]]");
    }

    #[test]
    fn backlinks_follow_a_frontmatter_alias() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(
            root,
            "Machine Learning.md",
            "---\naliases: [ML, \"Statistical learning\"]\n---\nx",
        );
        write(root, "a.md", "intro\nread [[ml#Basics]] first\n");
        write(root, "b.md", "[[Statistical learning|stats]]\n");
        write(root, "c.md", "[[Machine Learning]]\n");
        write(root, "d.md", "[[AI]]\n");

        let links = find_backlinks(root, "Machine Learning.md", &locked());
        let paths: Vec<&str> = links.iter().map(|b| b.path.as_str()).collect();

        assert_eq!(paths, vec!["a.md", "b.md", "c.md"]);
        assert_eq!(links[0].context, "read [[ml#Basics]] first");
    }

    #[test]
    fn backlinks_ignore_an_alias_shadowed_by_a_real_note() {
        // `ML.md` exists, so `[[ML]]` goes there, not to the note that
        // merely lists `ML` among its aliases.
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "ML.md", "x");
        write(root, "Machine Learning.md", "---\naliases: [ML]\n---\nx");
        write(root, "a.md", "[[ML]]\n");

        assert!(find_backlinks(root, "Machine Learning.md", &locked()).is_empty());
        assert_eq!(find_backlinks(root, "ML.md", &locked()).len(), 1);
    }

    #[test]
    fn list_notes_carries_aliases() {
        let dir = TempDir::new().unwrap();
        write(dir.path(), "a.md", "---\naliases: [x, y]\n---\n");

        assert_eq!(list_notes(dir.path())[0].aliases, vec!["x", "y"]);
    }

    #[test]
    fn backlinks_excludes_the_note_itself() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        // A note linking to its own name must not show up as its own backlink.
        write(root, "target.md", "I mention [[target]] myself");

        assert!(find_backlinks(root, "target.md", &locked()).is_empty());
    }

    #[test]
    fn backlinks_reports_the_linking_notes_folder() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "target.md", "x");
        write(root, "deep/nested/source.md", "[[target]]");

        let links = find_backlinks(root, "target.md", &locked());

        assert_eq!(links[0].folder, "deep/nested");
    }

    #[test]
    fn backlinks_sort_by_folder_then_title() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "target.md", "x");
        write(root, "b/one.md", "[[target]]");
        write(root, "a/zebra.md", "[[target]]");
        write(root, "a/apple.md", "[[target]]");

        let links = find_backlinks(root, "target.md", &locked());

        let order: Vec<&str> = links.iter().map(|l| l.path.as_str()).collect();
        assert_eq!(order, vec!["a/apple.md", "a/zebra.md", "b/one.md"]);
    }

    #[test]
    fn backlinks_resolve_for_an_encrypted_target() {
        // The bug this closes: `Path::file_stem` on `Secret.md.age` gives
        // `Secret.md`, which matches no wikilink, so the panel was always empty.
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "Secret.md.age", "ciphertext");
        write(root, "source.md", "points at [[Secret]]");

        let links = find_backlinks(root, "Secret.md.age", &locked());

        assert_eq!(links.len(), 1);
        assert_eq!(links[0].path, "source.md");
    }

    #[test]
    fn backlinks_skip_a_sealed_source_without_failing() {
        // A locked vault shows the backlinks it can rather than erroring.
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "target.md", "x");
        write(root, "sealed.md.age", "not real ciphertext [[target]]");
        write(root, "open.md", "[[target]]");

        let links = find_backlinks(root, "target.md", &locked());

        let paths: Vec<&str> = links.iter().map(|l| l.path.as_str()).collect();
        assert_eq!(paths, vec!["open.md"]);
    }

    #[test]
    fn backlinks_ignore_an_unrelated_link() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "target.md", "x");
        write(root, "source.md", "[[something else]]");

        assert!(find_backlinks(root, "target.md", &locked()).is_empty());
    }

    #[test]
    fn backlink_context_is_capped() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "target.md", "x");
        write(
            root,
            "source.md",
            &format!("[[target]] {}", "x".repeat(500)),
        );

        let links = find_backlinks(root, "target.md", &locked());

        assert!(links[0].context.chars().count() <= 120);
    }

    // ---- find_by_tag ------------------------------------------------------

    #[test]
    fn tag_search_finds_a_body_tag() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "a.md", "thinking about #ml today");
        write(root, "b.md", "nothing here");

        let hits = find_by_tag(root, "ml", &locked());

        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].path, "a.md");
    }

    #[test]
    fn tag_search_finds_a_frontmatter_tag() {
        let dir = TempDir::new().unwrap();
        write(dir.path(), "a.md", "---\ntags: [ideas, ml]\n---\n\nbody");

        assert_eq!(find_by_tag(dir.path(), "ml", &locked()).len(), 1);
    }

    #[test]
    fn tag_search_accepts_a_leading_hash_and_ignores_case() {
        let dir = TempDir::new().unwrap();
        write(dir.path(), "a.md", "about #ML here");

        assert_eq!(find_by_tag(dir.path(), "#ml", &locked()).len(), 1);
        assert_eq!(find_by_tag(dir.path(), "ML", &locked()).len(), 1);
    }

    #[test]
    fn tag_search_requires_a_whole_tag() {
        let dir = TempDir::new().unwrap();
        write(dir.path(), "a.md", "about #machine-learning");

        // `#machine-learning` is one tag; `#machine` is not in the note.
        assert!(find_by_tag(dir.path(), "machine", &locked()).is_empty());
    }

    #[test]
    fn an_empty_tag_matches_nothing() {
        let dir = TempDir::new().unwrap();
        write(dir.path(), "a.md", "#ml");

        assert!(find_by_tag(dir.path(), "", &locked()).is_empty());
        assert!(find_by_tag(dir.path(), "#", &locked()).is_empty());
        assert!(find_by_tag(dir.path(), "   ", &locked()).is_empty());
    }

    #[test]
    fn tag_search_sorts_by_title() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "z.md", "---\ntitle: Apple\ntags: [ml]\n---\n");
        write(root, "a.md", "---\ntitle: Banana\ntags: [ml]\n---\n");

        let titles: Vec<String> = find_by_tag(root, "ml", &locked())
            .into_iter()
            .map(|n| n.title)
            .collect();

        assert_eq!(titles, vec!["Apple", "Banana"]);
    }
}
