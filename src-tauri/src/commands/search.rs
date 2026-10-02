use crate::core::links::note_stem;
use crate::core::parser::parse_note;
use crate::core::vault::note_paths;
use crate::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

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
    for rel in note_paths(&vault_root) {
        let is_enc = rel.ends_with(".md.age");
        let stem = note_stem(&rel).to_string();
        let title = if is_enc {
            // We can't peek inside without unlocking — use the file stem.
            stem
        } else {
            std::fs::read_to_string(vault_root.join(&rel))
                .ok()
                .and_then(|content| parse_note(&content).meta.title)
                .unwrap_or(stem)
        };
        notes.push(NoteSummary { path: rel, title });
    }

    notes.sort_by(|a, b| a.title.cmp(&b.title));
    Ok(notes)
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

    // Target name without extension — this is what wikilinks reference.
    // `Path::file_stem` is wrong here: for `Note.md.age` it yields `Note.md`,
    // which matches no wikilink, so an encrypted note never had backlinks.
    let target_stem = note_stem(&path).to_lowercase();

    let mut backlinks = Vec::new();

    for rel in note_paths(&vault_root) {
        if rel == path {
            continue;
        }
        let file_path = vault_root.join(&rel);

        // An encrypted note's links are readable only while the vault is
        // unlocked. Try, and move on quietly when we can't — a locked vault
        // should show the backlinks it can rather than fail the panel.
        let content = if rel.ends_with(".md.age") {
            match std::fs::read(&file_path)
                .ok()
                .and_then(|raw| crate::core::crypto::decrypt_note(&state.crypto, &raw).ok())
            {
                Some(c) => c,
                None => continue,
            }
        } else {
            match std::fs::read_to_string(&file_path) {
                Ok(c) => c,
                Err(_) => continue,
            }
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
            let title = parsed
                .meta
                .title
                .unwrap_or_else(|| note_stem(&rel).to_string());

            // Find first line mentioning the target for context
            let context = parsed
                .body
                .lines()
                .find(|line| {
                    let lower = line.to_lowercase();
                    lower.contains(&format!("[[{}", target_stem))
                        || lower.contains(&format!("[[{path}"))
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

            backlinks.push(Backlink {
                path: rel,
                title,
                context,
                folder,
            });
        }
    }

    backlinks.sort_by(|a, b| a.folder.cmp(&b.folder).then(a.title.cmp(&b.title)));
    Ok(backlinks)
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

    let needle = tag.trim_start_matches('#').to_lowercase();
    if needle.is_empty() {
        return Ok(Vec::new());
    }

    let mut matches = Vec::new();
    for rel in note_paths(&vault_root) {
        // Tags inside an encrypted note are only readable while unlocked.
        let content = if rel.ends_with(".md.age") {
            match std::fs::read(vault_root.join(&rel))
                .ok()
                .and_then(|raw| crate::core::crypto::decrypt_note(&state.crypto, &raw).ok())
            {
                Some(c) => c,
                None => continue,
            }
        } else {
            match std::fs::read_to_string(vault_root.join(&rel)) {
                Ok(c) => c,
                Err(_) => continue,
            }
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
            .unwrap_or_else(|| note_stem(&rel).to_string());
        matches.push(NoteSummary { path: rel, title });
    }
    matches.sort_by(|a, b| a.title.cmp(&b.title));
    Ok(matches)
}
