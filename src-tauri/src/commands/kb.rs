use crate::core::vault::{read_kb_dirs, write_kb_dirs, KbEntry};
use crate::AppState;
use chrono::Utc;
use indexmap::IndexMap;
use serde::Serialize;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

use super::database::{ColumnDef, ColumnType, Database, Row, ViewDef};

#[derive(Clone, Serialize)]
struct FileChangedPayload<'a> {
    path: &'a str,
}

fn emit_changed(app: &AppHandle, path: &str) {
    let _ = app.emit("vault:file-changed", FileChangedPayload { path });
}

async fn vault_root(state: &State<'_, AppState>) -> Result<PathBuf, String> {
    let guard = state.vault.lock().await;
    guard
        .as_ref()
        .map(|v| v.root.clone())
        .ok_or_else(|| "No vault open".to_string())
}

/// Compute the sibling `.db.json` path for a directory. `papers` →
/// `papers.db.json`, `books/read` → `books/read.db.json`. Always returns a
/// vault-relative path with forward slashes.
fn db_path_for_dir(dir_rel: &str) -> String {
    let trimmed = dir_rel.trim_matches('/').replace('\\', "/");
    format!("{trimmed}.db.json")
}

fn index_path_for_dir(dir_rel: &str) -> String {
    let trimmed = dir_rel.trim_matches('/').replace('\\', "/");
    format!("{trimmed}/index.md")
}

fn default_kb_database() -> Database {
    let mut schema: IndexMap<String, ColumnDef> = IndexMap::new();
    schema.insert(
        "notes".into(),
        ColumnDef {
            col_type: ColumnType::RichText,
            label: "Notes".into(),
            options: None,
            width: Some(400),
            extra: HashMap::new(),
        },
    );

    let mut views: IndexMap<String, ViewDef> = IndexMap::new();
    views.insert(
        "default".into(),
        ViewDef {
            label: "All files".into(),
            // `__page__` is the built-in file-link pseudo-column (see
            // PAGE_COL in src/types/database.ts). Default KB starts with
            // just Page + Notes; the user adds more columns as needed.
            visible_columns: vec!["__page__".into(), "notes".into()],
            sort: None,
            filters: Vec::new(),
            row_limit: None,
            extra: HashMap::new(),
        },
    );

    Database {
        version: 1,
        pages_dir: None,
        schema,
        views,
        rows: Vec::new(),
        extra: HashMap::new(),
    }
}

/// Walk a single directory (non-recursive) and collect rows for every `.md`
/// file except `index.md`. Subfolders are ignored — KB v1 is flat per spec.
fn scan_dir_rows(abs_dir: &Path, dir_rel: &str) -> Result<Vec<Row>, String> {
    let mut rows = Vec::new();
    let read = std::fs::read_dir(abs_dir)
        .map_err(|e| format!("Failed to read {dir_rel}: {e}"))?;

    for entry in read.filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n,
            None => continue,
        };
        if name == "index.md" {
            continue;
        }
        if !name.ends_with(".md") {
            continue;
        }
        let rel = format!("{}/{}", dir_rel.trim_matches('/'), name);

        rows.push(Row {
            id: Uuid::new_v4().to_string(),
            page: Some(rel),
            values: HashMap::new(),
        });
    }

    // Stable, alphabetical order on activation so two runs against the same
    // directory produce the same `rows` order in the .db.json (the file is
    // checked into git in many vaults — minimize diff noise).
    rows.sort_by(|a, b| {
        let ap = a.page.as_deref().unwrap_or("");
        let bp = b.page.as_deref().unwrap_or("");
        ap.cmp(bp)
    });

    Ok(rows)
}

fn index_template(dir_rel: &str, db_path: &str) -> String {
    let dir_name = dir_rel.rsplit('/').next().unwrap_or(dir_rel);
    let depth = dir_rel.trim_matches('/').split('/').count();
    // Build the relative pointer from `<dir>/index.md` back to the sibling
    // `<dir>.db.json`. One `..` covers the `index.md` segment; each
    // additional path segment needs another `..`.
    let mut prefix = String::new();
    for _ in 0..depth {
        prefix.push_str("../");
    }
    let source = format!("{prefix}{db_path}");
    format!(
        "---\nkb: true\ndir: {dir_rel}\n---\n\n# {dir_name}\n\n```db\nsource: {source}\nview: default\n```\n\n<!-- Свободный текст ниже — редактируй как обычную заметку -->\n"
    )
}

#[derive(Debug, Serialize)]
pub struct KbInitResult {
    pub index_path: String,
    pub db_path: String,
    pub rows_created: u32,
}

#[tauri::command]
pub async fn kb_init(
    dir_path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<KbInitResult, String> {
    let root = vault_root(&state).await?;
    let dir_rel = dir_path.trim_matches('/').replace('\\', "/");
    if dir_rel.is_empty() {
        return Err("KB path cannot be empty".into());
    }
    let abs_dir = root.join(&dir_rel);
    if !abs_dir.is_dir() {
        return Err(format!("Not a directory: {dir_rel}"));
    }

    let db_rel = db_path_for_dir(&dir_rel);
    let index_rel = index_path_for_dir(&dir_rel);
    let abs_db = root.join(&db_rel);
    let abs_index = root.join(&index_rel);

    // 1. db.json — reuse existing if present, otherwise create with default
    //    schema and scanned rows. Per spec edge case: existing .db.json
    //    wins, we don't overwrite it.
    let mut rows_created: u32 = 0;
    if !abs_db.exists() {
        let mut db = default_kb_database();
        let rows = scan_dir_rows(&abs_dir, &dir_rel)?;
        rows_created = rows.len() as u32;
        db.rows = rows;
        if let Some(parent) = abs_db.parent() {
            std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let json = serde_json::to_string_pretty(&db).map_err(|e| e.to_string())?;
        std::fs::write(&abs_db, json)
            .map_err(|e| format!("Failed to write {db_rel}: {e}"))?;
        emit_changed(&app, &db_rel);
    }

    // 2. index.md — only create if it doesn't already exist. Edge case from
    //    spec (existing index.md → "use as KB page") is deferred to a UI
    //    confirmation in v1; here we conservatively leave the file alone.
    if !abs_index.exists() {
        let body = index_template(&dir_rel, &db_rel);
        std::fs::write(&abs_index, body)
            .map_err(|e| format!("Failed to write {index_rel}: {e}"))?;
        emit_changed(&app, &index_rel);
    }

    // 3. Register the KB in `.mycel/kb-dirs.json`. If the entry already
    //    exists (re-activation after deinit), leave the original
    //    `created_at` to preserve history.
    let mut config = read_kb_dirs(&root).unwrap_or_default();
    if !config.dirs.iter().any(|e| e.path == dir_rel) {
        config.dirs.push(KbEntry {
            path: dir_rel.clone(),
            db: db_rel.clone(),
            created_at: Utc::now().to_rfc3339(),
        });
    }
    write_kb_dirs(&root, &config).map_err(|e| e.to_string())?;

    Ok(KbInitResult {
        index_path: index_rel,
        db_path: db_rel,
        rows_created,
    })
}

#[tauri::command]
pub async fn kb_deinit(dir_path: String, state: State<'_, AppState>) -> Result<(), String> {
    let root = vault_root(&state).await?;
    let dir_rel = dir_path.trim_matches('/').replace('\\', "/");
    let mut config = read_kb_dirs(&root).unwrap_or_default();
    let before = config.dirs.len();
    config.dirs.retain(|e| e.path != dir_rel);
    if config.dirs.len() == before {
        // No-op deinit — return ok rather than erroring; UI may race with FS.
        return Ok(());
    }
    write_kb_dirs(&root, &config).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn kb_list(state: State<'_, AppState>) -> Result<Vec<KbEntry>, String> {
    let root = vault_root(&state).await?;
    Ok(read_kb_dirs(&root).unwrap_or_default().dirs)
}
