use crate::core::vault::{
    read_kb_dirs, write_kb_dirs, KbEntry, KNOWLEDGE_BASE_DIR, QUICK_NOTES_DIR,
};
use crate::AppState;
use chrono::Utc;
use indexmap::IndexMap;
use serde::Serialize;
use serde_json::Value as JsonValue;
use std::collections::{BTreeSet, HashMap};
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

fn default_kb_database(area_options: Vec<String>) -> Database {
    let mut schema: IndexMap<String, ColumnDef> = IndexMap::new();
    // `area` holds the folder names along the file's path inside the KB
    // root (e.g. a file at `<kb>/projects/work/note.md` gets
    // `["projects", "work"]`). Multi-select so each segment is its own
    // selectable tag. Marked readonly because kb_refresh re-derives the
    // value from the file path on every refresh — letting the user edit
    // it would just make their change vanish on the next sync.
    let mut area_extra: HashMap<String, JsonValue> = HashMap::new();
    area_extra.insert("readonly".into(), JsonValue::Bool(true));
    schema.insert(
        "area".into(),
        ColumnDef {
            col_type: ColumnType::MultiSelect,
            label: "Area".into(),
            options: Some(area_options),
            width: Some(200),
            extra: area_extra,
        },
    );
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
            // PAGE_COL in src/types/database.ts).
            visible_columns: vec!["__page__".into(), "area".into(), "notes".into()],
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

/// Walk the KB directory recursively and collect one row per `.md` file
/// (except the KB's own top-level `index.md`). Returns the rows and the
/// deduped set of folder names encountered along the way — those names
/// become the multi-select options for the `area` column.
fn scan_dir_rows(
    abs_dir: &Path,
    dir_rel: &str,
) -> Result<(Vec<Row>, BTreeSet<String>), String> {
    let scanned = scan_kb_files(abs_dir)?;
    let areas: BTreeSet<String> = scanned
        .iter()
        .flat_map(|f| f.area.iter().cloned())
        .collect();
    let mut rows: Vec<Row> = scanned
        .into_iter()
        .map(|f| {
            let mut values: HashMap<String, JsonValue> = HashMap::new();
            if !f.area.is_empty() {
                values.insert("area".into(), area_to_json(&f.area));
            }
            Row {
                id: Uuid::new_v4().to_string(),
                page: Some(format!("{}/{}", dir_rel.trim_matches('/'), f.inner_rel)),
                values,
            }
        })
        .collect();

    // Stable, alphabetical order on activation so two runs against the same
    // directory produce the same `rows` order in the .db.json (the file is
    // checked into git in many vaults — minimize diff noise).
    rows.sort_by(|a, b| {
        let ap = a.page.as_deref().unwrap_or("");
        let bp = b.page.as_deref().unwrap_or("");
        ap.cmp(bp)
    });

    Ok((rows, areas))
}

/// A single file discovered during a recursive KB scan.
struct ScannedFile {
    /// Path relative to the KB root, with forward slashes
    /// (e.g. `projects/work/note.md`).
    inner_rel: String,
    /// Folder segments between the KB root and the file's parent
    /// (e.g. `["projects", "work"]`). Empty for files at the KB root.
    area: Vec<String>,
}

fn area_to_json(area: &[String]) -> JsonValue {
    JsonValue::Array(
        area.iter()
            .cloned()
            .map(JsonValue::String)
            .collect(),
    )
}

fn scan_kb_files(abs_dir: &Path) -> Result<Vec<ScannedFile>, String> {
    let mut out = Vec::new();
    walk_kb(abs_dir, abs_dir, &mut out)?;
    out.sort_by(|a, b| a.inner_rel.cmp(&b.inner_rel));
    Ok(out)
}

fn walk_kb(
    cur: &Path,
    kb_root: &Path,
    out: &mut Vec<ScannedFile>,
) -> Result<(), String> {
    let read = std::fs::read_dir(cur)
        .map_err(|e| format!("Failed to read {}: {e}", cur.display()))?;

    for entry in read.filter_map(|e| e.ok()) {
        let path = entry.path();
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n.to_string(),
            None => continue,
        };
        // Skip hidden entries (`.git`, `.DS_Store`, etc.) at every level.
        if name.starts_with('.') {
            continue;
        }
        if path.is_dir() {
            walk_kb(&path, kb_root, out)?;
            continue;
        }
        if !path.is_file() || !name.ends_with(".md") {
            continue;
        }

        let inner_rel = path
            .strip_prefix(kb_root)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");

        // The KB's own top-level `index.md` is the KB page itself and
        // must not become a row. Nested `index.md` files (e.g. folder
        // readmes) are real notes and stay.
        if inner_rel == "index.md" {
            continue;
        }

        let area: Vec<String> = match inner_rel.rsplit_once('/') {
            Some((parent, _)) => parent
                .split('/')
                .filter(|s| !s.is_empty())
                .map(String::from)
                .collect(),
            None => Vec::new(),
        };

        out.push(ScannedFile { inner_rel, area });
    }

    Ok(())
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
    let mut out = String::new();
    out.push_str(&format!("# {dir_name}\n\n"));
    out.push_str("> Это страница папки-базы знаний. Таблица ниже автоматически собирает все заметки из этой папки и её подпапок. Колонка **Area** заполняется по пути файла и не редактируется вручную — добавь подпапку, и тег появится сам. Остальные колонки можно править как угодно.\n");
    out.push_str(">\n");
    out.push_str("> Под таблицей можно писать обычный текст — он сохранится как заметка папки.\n\n");
    out.push_str(&format!("```db\nsource: {source}\nview: default\n```\n\n"));
    out
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
    // Folders inside the protected `Knowledge Base/` / `quick/` roots are
    // off-limits: that area is owned by the standalone-database / quick-
    // capture systems. Rejecting at the boundary keeps both mechanisms
    // tidy regardless of how the request reached us.
    let kb_prefix = format!("{KNOWLEDGE_BASE_DIR}/");
    let quick_prefix = format!("{QUICK_NOTES_DIR}/");
    if dir_rel == KNOWLEDGE_BASE_DIR
        || dir_rel == QUICK_NOTES_DIR
        || dir_rel.starts_with(&kb_prefix)
        || dir_rel.starts_with(&quick_prefix)
    {
        return Err(format!(
            "Folders inside '{KNOWLEDGE_BASE_DIR}/' or '{QUICK_NOTES_DIR}/' cannot be promoted to Knowledge Bases."
        ));
    }
    let abs_dir = root.join(&dir_rel);
    if !abs_dir.is_dir() {
        return Err(format!("Not a directory: {dir_rel}"));
    }

    // A KB can only be created at the root of its file tree — promoting
    // a folder that sits inside an already-registered KB would produce
    // overlapping databases over the same files. Re-init on the same
    // path is fine (idempotent) and handled by the `!=` check below.
    let mut config = read_kb_dirs(&root).unwrap_or_default();
    for existing in &config.dirs {
        let p = existing.path.trim_matches('/');
        if p.is_empty() || p == dir_rel {
            continue;
        }
        let prefix = format!("{p}/");
        if dir_rel.starts_with(&prefix) {
            return Err(format!(
                "Folder '{dir_rel}' is inside Knowledge Base '{p}'. Only the root folder of a KB can be promoted."
            ));
        }
    }

    let db_rel = db_path_for_dir(&dir_rel);
    let index_rel = index_path_for_dir(&dir_rel);
    let abs_db = root.join(&db_rel);
    let abs_index = root.join(&index_rel);

    let lock = state.db_lock(&abs_db);
    let _guard = lock.lock().await;

    // 1. db.json — reuse existing if present, otherwise create with default
    //    schema and scanned rows. Per spec edge case: existing .db.json
    //    wins, we don't overwrite it.
    let mut rows_created: u32 = 0;
    if !abs_db.exists() {
        let (rows, areas) = scan_dir_rows(&abs_dir, &dir_rel)?;
        rows_created = rows.len() as u32;
        let mut db = default_kb_database(areas.into_iter().collect());
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

/// Remove the KB from the directory entirely: drop the registry entry,
/// delete `<dir>/index.md` and the sibling `<dir>.db.json`. The user's
/// `.md` notes inside the directory are left alone — they were the user's
/// content before the KB existed and remain so after.
///
/// Deleting the `.db.json` also takes the database out of the global
/// databases list, so it no longer appears in the "insert database"
/// picker.
#[tauri::command]
pub async fn kb_deinit(
    dir_path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let root = vault_root(&state).await?;
    let dir_rel = dir_path.trim_matches('/').replace('\\', "/");
    if dir_rel.is_empty() {
        return Err("KB path cannot be empty".into());
    }

    let db_rel = db_path_for_dir(&dir_rel);
    let index_rel = index_path_for_dir(&dir_rel);
    let abs_db = root.join(&db_rel);
    let abs_index = root.join(&index_rel);

    let lock = state.db_lock(&abs_db);
    let _guard = lock.lock().await;

    if abs_db.exists() {
        std::fs::remove_file(&abs_db)
            .map_err(|e| format!("Failed to delete {db_rel}: {e}"))?;
        emit_changed(&app, &db_rel);
    }
    if abs_index.exists() {
        std::fs::remove_file(&abs_index)
            .map_err(|e| format!("Failed to delete {index_rel}: {e}"))?;
        emit_changed(&app, &index_rel);
    }

    let mut config = read_kb_dirs(&root).unwrap_or_default();
    config.dirs.retain(|e| e.path != dir_rel);
    write_kb_dirs(&root, &config).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn kb_list(state: State<'_, AppState>) -> Result<Vec<KbEntry>, String> {
    let root = vault_root(&state).await?;
    Ok(read_kb_dirs(&root).unwrap_or_default().dirs)
}

#[derive(Debug, Serialize, Clone)]
pub struct KbRefreshResult {
    pub db_path: String,
    pub added: u32,
    pub removed: u32,
    pub kept: u32,
}

/// Reconcile the rows in `<dir>.db.json` with the current filesystem
/// state of `<dir>/`. Used both by the manual "Refresh" action and by
/// the watcher when notes are added / renamed / moved / deleted while
/// the app is open.
///
/// Matching is by `page` path: a row whose file still exists is kept
/// (its `area` value is re-derived from the current path so a folder
/// rename propagates), missing files cause their row to be dropped,
/// and files without a row get a new row.
///
/// Custom column values, view configuration, and free-form (page-less)
/// rows are preserved. The `area` column's `options` list is widened
/// to cover every folder name currently on disk; existing options
/// (e.g. ones the user added by hand) are kept.
///
/// Perf: synchronous fs walk + JSON read/write. Measured budget:
/// ~50 ms for ~1k files, ~500 ms for ~10k. The Tauri command wraps
/// this in an `async fn` so a very large KB will block one tokio
/// task during refresh — wrap in `tokio::task::spawn_blocking` if
/// that ever shows up in profiles.
pub fn refresh_kb_db(
    root: &Path,
    dir_rel_raw: &str,
) -> Result<KbRefreshResult, String> {
    let dir_rel = dir_rel_raw.trim_matches('/').replace('\\', "/");
    if dir_rel.is_empty() {
        return Err("KB path cannot be empty".into());
    }
    let abs_dir = root.join(&dir_rel);
    if !abs_dir.is_dir() {
        return Err(format!("Not a directory: {dir_rel}"));
    }
    let db_rel = db_path_for_dir(&dir_rel);
    let abs_db = root.join(&db_rel);
    if !abs_db.exists() {
        return Err(format!("Not a knowledge base: {dir_rel}"));
    }

    let raw = std::fs::read_to_string(&abs_db)
        .map_err(|e| format!("Failed to read {db_rel}: {e}"))?;
    let mut db: Database = serde_json::from_str(&raw)
        .map_err(|e| format!("Cannot parse {db_rel}: {e}"))?;

    let scanned = scan_kb_files(&abs_dir)?;

    // Build a lookup of scanned files by their full vault-relative `page`
    // path so we can match existing rows against the current filesystem
    // state without losing the row's original position in `db.rows`.
    let dir_prefix = dir_rel.trim_matches('/');
    let mut by_page_scanned: HashMap<String, &ScannedFile> = HashMap::new();
    for f in &scanned {
        by_page_scanned.insert(format!("{}/{}", dir_prefix, f.inner_rel), f);
    }

    // Walk existing rows in their original order: keep each one whose page
    // still exists on disk (refreshing its `area`), drop the rest. Detached
    // rows (no `page`) are preserved verbatim. This preserves the user's
    // hand-curated row order across refreshes — before, every refresh
    // re-sorted alphabetically by path and made the "+ New row" entry
    // appear somewhere in the middle of the table.
    let mut synced: Vec<Row> = Vec::with_capacity(scanned.len() + db.rows.len());
    let mut detached: Vec<Row> = Vec::new();
    let mut seen_pages: std::collections::HashSet<String> =
        std::collections::HashSet::new();
    let mut kept: u32 = 0;
    let mut removed: u32 = 0;
    for row in db.rows.drain(..) {
        match row.page.clone() {
            None => detached.push(row),
            Some(p) => {
                if let Some(f) = by_page_scanned.get(&p) {
                    let mut row = row;
                    if f.area.is_empty() {
                        row.values.remove("area");
                    } else {
                        row.values.insert("area".into(), area_to_json(&f.area));
                    }
                    seen_pages.insert(p);
                    synced.push(row);
                    kept += 1;
                } else {
                    removed += 1;
                }
            }
        }
    }

    // Newly-discovered files (no matching row yet) append at the end in the
    // order `scan_kb_files` returned them — which is alphabetical, but only
    // among themselves, so freshly-created rows still land after everything
    // the user already had.
    let mut added: u32 = 0;
    for f in &scanned {
        let page = format!("{}/{}", dir_prefix, f.inner_rel);
        if seen_pages.contains(&page) {
            continue;
        }
        let mut values: HashMap<String, JsonValue> = HashMap::new();
        if !f.area.is_empty() {
            values.insert("area".into(), area_to_json(&f.area));
        }
        synced.push(Row {
            id: Uuid::new_v4().to_string(),
            page: Some(page),
            values,
        });
        added += 1;
    }

    synced.extend(detached);
    db.rows = synced;

    // Widen the `area` column's options to cover every folder name
    // currently on disk. Older KBs (created before the recursive scan
    // existed) may not have the column at all — add it then.
    let discovered: BTreeSet<String> = scanned
        .iter()
        .flat_map(|f| f.area.iter().cloned())
        .collect();
    if let Some(col) = db.schema.get_mut("area") {
        let mut merged: BTreeSet<String> = col
            .options
            .clone()
            .unwrap_or_default()
            .into_iter()
            .collect();
        merged.extend(discovered);
        col.options = Some(merged.into_iter().collect());
        // Forward migration: existing KBs created before the readonly flag
        // existed get it stamped on every refresh, so their Area column
        // stops accepting manual edits that the next refresh would wipe.
        col.extra
            .insert("readonly".into(), JsonValue::Bool(true));
    } else {
        let mut area_extra: HashMap<String, JsonValue> = HashMap::new();
        area_extra.insert("readonly".into(), JsonValue::Bool(true));
        db.schema.insert(
            "area".into(),
            ColumnDef {
                col_type: ColumnType::MultiSelect,
                label: "Area".into(),
                options: Some(discovered.into_iter().collect()),
                width: Some(200),
                extra: area_extra,
            },
        );
        for view in db.views.values_mut() {
            if !view.visible_columns.contains(&"area".to_string()) {
                view.visible_columns.push("area".into());
            }
        }
    }

    let pretty = serde_json::to_string_pretty(&db).map_err(|e| e.to_string())?;
    std::fs::write(&abs_db, pretty)
        .map_err(|e| format!("Failed to write {db_rel}: {e}"))?;

    Ok(KbRefreshResult {
        db_path: db_rel,
        added,
        removed,
        kept,
    })
}

#[tauri::command]
pub async fn kb_refresh(
    dir_path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<KbRefreshResult, String> {
    let root = vault_root(&state).await?;
    // Hold the per-db lock so a concurrent db_update_cell / db_create_page
    // can't read the same db.json snapshot we're about to overwrite.
    let dir_rel = dir_path.trim_matches('/').replace('\\', "/");
    let db_rel = db_path_for_dir(&dir_rel);
    let abs_db = root.join(&db_rel);
    let lock = state.db_lock(&abs_db);
    let _guard = lock.lock().await;
    let result = refresh_kb_db(&root, &dir_path)?;
    emit_changed(&app, &result.db_path);
    Ok(result)
}
