use crate::core::parser::parse_note;
use crate::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;
use walkdir::WalkDir;

#[derive(Debug, Serialize, Deserialize)]
pub struct NoteSummary {
    pub path: String,
    pub title: String,
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

#[tauri::command]
pub async fn notes_list(state: State<'_, AppState>) -> Result<Vec<NoteSummary>, String> {
    let vault_root = {
        let guard = state.vault.lock().await;
        guard
            .as_ref()
            .map(|v| v.root.clone())
            .ok_or("No vault open")?
    };

    let mut notes = Vec::new();
    for entry in WalkDir::new(&vault_root).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.extension().map(|e| e == "md").unwrap_or(false) {
            let rel = path
                .strip_prefix(&vault_root)
                .unwrap_or(path)
                .to_string_lossy()
                .to_string();

            // Skip hidden dirs
            if rel.contains("/.") || rel.starts_with('.') {
                continue;
            }

            let stem = path
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();

            // Try to read title from frontmatter, fallback to stem
            let title = std::fs::read_to_string(path)
                .ok()
                .and_then(|content| {
                    let parsed = parse_note(&content);
                    parsed.meta.title
                })
                .unwrap_or(stem);

            notes.push(NoteSummary { path: rel, title });
        }
    }

    notes.sort_by(|a, b| a.title.cmp(&b.title));
    Ok(notes)
}

#[tauri::command]
pub async fn backlinks_get(path: String, state: State<'_, AppState>) -> Result<Vec<Backlink>, String> {
    let vault_root = {
        let guard = state.vault.lock().await;
        guard
            .as_ref()
            .map(|v| v.root.clone())
            .ok_or("No vault open")?
    };

    // Target name without extension — this is what wikilinks reference
    let target_stem = std::path::Path::new(&path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();

    let mut backlinks = Vec::new();

    for entry in WalkDir::new(&vault_root).into_iter().filter_map(|e| e.ok()) {
        let file_path = entry.path();
        if !file_path.extension().map(|e| e == "md").unwrap_or(false) {
            continue;
        }

        let rel = file_path
            .strip_prefix(&vault_root)
            .unwrap_or(file_path)
            .to_string_lossy()
            .to_string();

        // Skip hidden, skip the note itself
        if rel.contains("/.") || rel.starts_with('.') || rel == path {
            continue;
        }

        let content = match std::fs::read_to_string(file_path) {
            Ok(c) => c,
            Err(_) => continue,
        };

        let parsed = parse_note(&content);

        // Match the target loosely: accept wikilinks written as `[[Note]]`,
        // `[[folder/Note]]`, or `[[Note.md]]` — strip any path prefix and the
        // optional `.md` extension before comparing. Heading anchors after `#`
        // are also ignored.
        let has_link = parsed.wikilinks.iter().any(|wl| {
            let mut t = wl.target.to_lowercase();
            if let Some(idx) = t.find('#') {
                t.truncate(idx);
            }
            let t = t.trim();
            let stem = std::path::Path::new(t)
                .file_stem()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_else(|| t.to_string());
            stem == target_stem
        });

        if has_link {
            let title = parsed.meta.title.unwrap_or_else(|| {
                file_path
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_default()
            });

            // Find first line mentioning the target for context
            let context = parsed
                .body
                .lines()
                .find(|line| {
                    let lower = line.to_lowercase();
                    lower.contains(&format!("[[{}", target_stem))
                        || lower.contains(&format!("[[{}", &path))
                })
                .unwrap_or("")
                .trim()
                .chars()
                .take(120)
                .collect();

            let folder = std::path::Path::new(&rel)
                .parent()
                .map(|p| p.to_string_lossy().to_string())
                .unwrap_or_default();

            backlinks.push(Backlink { path: rel, title, context, folder });
        }
    }

    backlinks.sort_by(|a, b| a.folder.cmp(&b.folder).then(a.title.cmp(&b.title)));
    Ok(backlinks)
}

#[tauri::command]
pub async fn notes_by_tag(tag: String, state: State<'_, AppState>) -> Result<Vec<NoteSummary>, String> {
    let vault_root = {
        let guard = state.vault.lock().await;
        guard
            .as_ref()
            .map(|v| v.root.clone())
            .ok_or("No vault open")?
    };

    let needle = tag.trim_start_matches('#').to_lowercase();
    if needle.is_empty() {
        return Ok(Vec::new());
    }

    let mut matches = Vec::new();
    for entry in WalkDir::new(&vault_root).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.extension().map(|e| e == "md").unwrap_or(false) {
            continue;
        }
        let rel = path
            .strip_prefix(&vault_root)
            .unwrap_or(path)
            .to_string_lossy()
            .to_string();
        if rel.contains("/.") || rel.starts_with('.') {
            continue;
        }
        let content = match std::fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let parsed = parse_note(&content);
        let in_body = parsed.tags.iter().any(|t| t.to_lowercase() == needle);
        let in_meta = parsed
            .meta
            .tags
            .iter()
            .any(|t| t.to_lowercase() == needle);
        if !in_body && !in_meta {
            continue;
        }
        let stem = path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        let title = parsed.meta.title.unwrap_or(stem);
        matches.push(NoteSummary { path: rel, title });
    }
    matches.sort_by(|a, b| a.title.cmp(&b.title));
    Ok(matches)
}
