use crate::core::parser::{parse_note, ParsedNote};
use crate::core::vault::KNOWLEDGE_BASE_DIR;
use crate::AppState;
use serde::{Deserialize, Serialize};
use tauri::State;

fn is_protected(rel_path: &str) -> bool {
    rel_path == KNOWLEDGE_BASE_DIR
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Note {
    pub path: String,
    pub content: String,
    pub parsed: ParsedNote,
}

#[tauri::command]
pub fn render_html(content: String) -> String {
    use pulldown_cmark::{html, Options, Parser};
    let opts = Options::ENABLE_TABLES
        | Options::ENABLE_FOOTNOTES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS;
    let parser = Parser::new_ext(&content, opts);
    let mut output = String::new();
    html::push_html(&mut output, parser);
    output
}

#[tauri::command]
pub async fn note_read(path: String, state: State<'_, AppState>) -> Result<Note, String> {
    let vault_root = {
        let guard = state.vault.lock().await;
        guard
            .as_ref()
            .map(|v| v.root.clone())
            .ok_or("No vault open")?
    };

    let abs_path = vault_root.join(&path);
    let content = std::fs::read_to_string(&abs_path)
        .map_err(|e| format!("Failed to read {path}: {e}"))?;
    let parsed = parse_note(&content);

    Ok(Note { path, content, parsed })
}

#[tauri::command]
pub async fn note_save(path: String, content: String, state: State<'_, AppState>) -> Result<(), String> {
    let vault_root = {
        let guard = state.vault.lock().await;
        guard
            .as_ref()
            .map(|v| v.root.clone())
            .ok_or("No vault open")?
    };

    let abs_path = vault_root.join(&path);
    if let Some(parent) = abs_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&abs_path, &content).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn note_create(path: String, state: State<'_, AppState>) -> Result<Note, String> {
    let initial = format!("# {}\n\n", path.trim_end_matches(".md").split('/').last().unwrap_or("Untitled"));
    note_save(path.clone(), initial.clone(), state.clone()).await?;
    let parsed = parse_note(&initial);
    Ok(Note { path, content: initial, parsed })
}

#[tauri::command]
pub async fn folder_create(path: String, state: State<'_, AppState>) -> Result<(), String> {
    let vault_root = {
        let guard = state.vault.lock().await;
        guard
            .as_ref()
            .map(|v| v.root.clone())
            .ok_or("No vault open")?
    };
    let abs_path = vault_root.join(&path);
    std::fs::create_dir_all(&abs_path).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn note_delete(path: String, state: State<'_, AppState>) -> Result<(), String> {
    if is_protected(&path) {
        return Err("This folder is managed by Mycel and cannot be deleted".into());
    }
    let vault_root = {
        let guard = state.vault.lock().await;
        guard
            .as_ref()
            .map(|v| v.root.clone())
            .ok_or("No vault open")?
    };
    let abs_path = vault_root.join(&path);
    if abs_path.is_dir() {
        std::fs::remove_dir_all(&abs_path).map_err(|e| e.to_string())?;
    } else {
        std::fs::remove_file(&abs_path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub async fn note_rename(old_path: String, new_path: String, state: State<'_, AppState>) -> Result<(), String> {
    if is_protected(&old_path) {
        return Err("This folder is managed by Mycel and cannot be renamed".into());
    }
    let vault_root = {
        let guard = state.vault.lock().await;
        guard
            .as_ref()
            .map(|v| v.root.clone())
            .ok_or("No vault open")?
    };
    let old_abs = vault_root.join(&old_path);
    let new_abs = vault_root.join(&new_path);
    if let Some(parent) = new_abs.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::rename(&old_abs, &new_abs).map_err(|e| e.to_string())?;
    Ok(())
}
