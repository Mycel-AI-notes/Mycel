use crate::AppState;
use indexmap::IndexMap;
use serde::{Deserialize, Serialize};
use serde_json::Value as JsonValue;
use std::collections::HashMap;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, State};

#[derive(Clone, Serialize)]
struct FileChangedPayload<'a> {
    path: &'a str,
}

fn emit_changed(app: &AppHandle, path: &str) {
    let _ = app.emit("vault:file-changed", FileChangedPayload { path });
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ColumnType {
    Text,
    Number,
    Select,
    MultiSelect,
    Checkbox,
    Date,
    RichText,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ColumnDef {
    #[serde(rename = "type")]
    pub col_type: ColumnType,
    pub label: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub options: Option<Vec<String>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<u32>,
    // Forward compatibility: preserve unknown fields
    #[serde(flatten)]
    pub extra: HashMap<String, JsonValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SortDef {
    pub field: String,
    pub dir: String, // "asc" | "desc"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FilterDef {
    pub field: String,
    pub op: String,
    #[serde(default)]
    pub value: JsonValue,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ViewDef {
    pub label: String,
    #[serde(default)]
    pub visible_columns: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sort: Option<SortDef>,
    #[serde(default)]
    pub filters: Vec<FilterDef>,
    #[serde(flatten)]
    pub extra: HashMap<String, JsonValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Row {
    pub id: String,
    #[serde(default)]
    pub page: Option<String>,
    #[serde(flatten)]
    pub values: HashMap<String, JsonValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Database {
    pub version: u32,
    #[serde(default)]
    pub schema: IndexMap<String, ColumnDef>,
    #[serde(default)]
    pub views: IndexMap<String, ViewDef>,
    #[serde(default)]
    pub rows: Vec<Row>,
    // Forward compatibility for unknown top-level fields
    #[serde(flatten)]
    pub extra: HashMap<String, JsonValue>,
}

impl Default for Database {
    fn default() -> Self {
        Self {
            version: 1,
            schema: IndexMap::new(),
            views: IndexMap::new(),
            rows: Vec::new(),
            extra: HashMap::new(),
        }
    }
}

async fn vault_root(state: &State<'_, AppState>) -> Result<PathBuf, String> {
    let guard = state.vault.lock().await;
    guard
        .as_ref()
        .map(|v| v.root.clone())
        .ok_or_else(|| "No vault open".to_string())
}

fn read_db(abs: &PathBuf) -> Result<Database, String> {
    let raw = std::fs::read_to_string(abs).map_err(|e| format!("Failed to read db: {e}"))?;
    serde_json::from_str(&raw).map_err(|e| format!("Cannot parse database file: {e}"))
}

fn write_db(abs: &PathBuf, db: &Database) -> Result<(), String> {
    if let Some(parent) = abs.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string_pretty(db).map_err(|e| e.to_string())?;
    std::fs::write(abs, json).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn db_read(path: String, state: State<'_, AppState>) -> Result<Database, String> {
    let root = vault_root(&state).await?;
    let abs = root.join(&path);
    read_db(&abs)
}

#[tauri::command]
pub async fn db_write(
    path: String,
    database: Database,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let root = vault_root(&state).await?;
    let abs = root.join(&path);
    write_db(&abs, &database)?;
    emit_changed(&app, &path);
    Ok(())
}

#[tauri::command]
pub async fn db_create(
    path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Database, String> {
    let root = vault_root(&state).await?;
    let abs = root.join(&path);
    if abs.exists() {
        return read_db(&abs);
    }

    let mut db = Database::default();
    let mut col = ColumnDef {
        col_type: ColumnType::Text,
        label: "Title".into(),
        options: None,
        width: Some(220),
        extra: HashMap::new(),
    };
    col.extra.clear();
    db.schema.insert("title".to_string(), col);

    let view = ViewDef {
        label: "Default".into(),
        visible_columns: vec!["title".into()],
        sort: None,
        filters: Vec::new(),
        extra: HashMap::new(),
    };
    db.views.insert("default".to_string(), view);

    write_db(&abs, &db)?;
    emit_changed(&app, &path);
    Ok(db)
}

#[tauri::command]
pub async fn db_update_cell(
    path: String,
    row_id: String,
    column_id: String,
    value: JsonValue,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let root = vault_root(&state).await?;
    let abs = root.join(&path);
    let mut db = read_db(&abs)?;

    let row = db
        .rows
        .iter_mut()
        .find(|r| r.id == row_id)
        .ok_or_else(|| format!("Row {row_id} not found"))?;

    if column_id == "page" {
        row.page = match value {
            JsonValue::Null => None,
            JsonValue::String(s) => Some(s),
            _ => return Err("page must be string or null".into()),
        };
    } else if value.is_null() {
        row.values.remove(&column_id);
    } else {
        row.values.insert(column_id, value);
    }

    write_db(&abs, &db)?;
    emit_changed(&app, &path);
    Ok(())
}

#[tauri::command]
pub async fn db_add_row(
    path: String,
    row: Option<Row>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let root = vault_root(&state).await?;
    let abs = root.join(&path);
    let mut db = read_db(&abs)?;

    let mut new_row = row.unwrap_or_else(|| Row {
        id: String::new(),
        page: None,
        values: HashMap::new(),
    });
    if new_row.id.is_empty() {
        new_row.id = uuid::Uuid::new_v4().to_string();
    }
    let id = new_row.id.clone();
    db.rows.push(new_row);
    write_db(&abs, &db)?;
    emit_changed(&app, &path);
    Ok(id)
}

#[tauri::command]
pub async fn db_delete_row(
    path: String,
    row_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let root = vault_root(&state).await?;
    let abs = root.join(&path);
    let mut db = read_db(&abs)?;
    db.rows.retain(|r| r.id != row_id);
    write_db(&abs, &db)?;
    emit_changed(&app, &path);
    Ok(())
}

#[tauri::command]
pub async fn db_add_column(
    path: String,
    column_id: String,
    column_def: ColumnDef,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let root = vault_root(&state).await?;
    let abs = root.join(&path);
    let mut db = read_db(&abs)?;
    if db.schema.contains_key(&column_id) {
        return Err(format!("Column '{column_id}' already exists"));
    }
    db.schema.insert(column_id.clone(), column_def);
    // Make new column visible in all views
    for view in db.views.values_mut() {
        if !view.visible_columns.contains(&column_id) {
            view.visible_columns.push(column_id.clone());
        }
    }
    write_db(&abs, &db)?;
    emit_changed(&app, &path);
    Ok(())
}

#[tauri::command]
pub async fn db_delete_column(
    path: String,
    column_id: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let root = vault_root(&state).await?;
    let abs = root.join(&path);
    let mut db = read_db(&abs)?;
    db.schema.shift_remove(&column_id);
    for row in db.rows.iter_mut() {
        row.values.remove(&column_id);
    }
    for view in db.views.values_mut() {
        view.visible_columns.retain(|c| c != &column_id);
        view.filters.retain(|f| f.field != column_id);
        if let Some(ref s) = view.sort {
            if s.field == column_id {
                view.sort = None;
            }
        }
    }
    write_db(&abs, &db)?;
    emit_changed(&app, &path);
    Ok(())
}

#[tauri::command]
pub async fn db_update_column(
    path: String,
    column_id: String,
    column_def: ColumnDef,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let root = vault_root(&state).await?;
    let abs = root.join(&path);
    let mut db = read_db(&abs)?;
    if !db.schema.contains_key(&column_id) {
        return Err(format!("Column '{column_id}' not found"));
    }
    db.schema.insert(column_id, column_def);
    write_db(&abs, &db)?;
    emit_changed(&app, &path);
    Ok(())
}

#[tauri::command]
pub async fn db_update_view(
    path: String,
    view_id: String,
    view_def: ViewDef,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let root = vault_root(&state).await?;
    let abs = root.join(&path);
    let mut db = read_db(&abs)?;
    db.views.insert(view_id, view_def);
    write_db(&abs, &db)?;
    emit_changed(&app, &path);
    Ok(())
}

#[tauri::command]
pub async fn db_create_page(
    db_path: String,
    row_id: String,
    note_path: String,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let root = vault_root(&state).await?;
    let abs_db = root.join(&db_path);
    let abs_note = root.join(&note_path);

    if abs_note.exists() {
        return Err(format!("File already exists: {note_path}"));
    }

    let mut db = read_db(&abs_db)?;
    let row = db
        .rows
        .iter_mut()
        .find(|r| r.id == row_id)
        .ok_or_else(|| format!("Row {row_id} not found"))?;

    // Build frontmatter from row values
    let title_stem = std::path::Path::new(&note_path)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "Untitled".to_string());

    let mut frontmatter = String::from("---\n");
    let title_val = row
        .values
        .get("title")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
        .unwrap_or_else(|| title_stem.clone());
    frontmatter.push_str(&format!("title: {}\n", yaml_escape(&title_val)));

    for (key, val) in row.values.iter() {
        if key == "title" {
            continue;
        }
        if let Some(s) = val.as_str() {
            frontmatter.push_str(&format!("{}: {}\n", key, yaml_escape(s)));
        } else if val.is_array() || val.is_number() || val.is_boolean() {
            frontmatter.push_str(&format!("{}: {}\n", key, val));
        }
    }
    frontmatter.push_str("---\n\n");
    frontmatter.push_str(&format!("# {}\n", title_val));

    if let Some(parent) = abs_note.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&abs_note, frontmatter).map_err(|e| e.to_string())?;

    row.page = Some(note_path);
    write_db(&abs_db, &db)?;
    emit_changed(&app, &db_path);
    Ok(())
}

#[derive(Debug, Serialize)]
pub struct ViewSummary {
    pub id: String,
    pub label: String,
}

#[derive(Debug, Serialize)]
pub struct DbSummary {
    pub path: String,
    pub name: String,
    pub views: Vec<ViewSummary>,
}

#[tauri::command]
pub async fn dbs_list(state: State<'_, AppState>) -> Result<Vec<DbSummary>, String> {
    let root = vault_root(&state).await?;
    let mut out = Vec::new();
    for entry in walkdir::WalkDir::new(&root).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        let name = match path.file_name().and_then(|n| n.to_str()) {
            Some(n) => n,
            None => continue,
        };
        if !name.ends_with(".db.json") {
            continue;
        }
        let rel = path
            .strip_prefix(&root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/");
        if rel.contains("/.") || rel.starts_with('.') {
            continue;
        }
        let stem = name.trim_end_matches(".db.json").to_string();
        let views = match read_db(&path.to_path_buf()) {
            Ok(db) => db
                .views
                .iter()
                .map(|(id, def)| ViewSummary {
                    id: id.clone(),
                    label: def.label.clone(),
                })
                .collect(),
            Err(_) => Vec::new(),
        };
        out.push(DbSummary {
            path: rel,
            name: stem,
            views,
        });
    }
    out.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    Ok(out)
}

fn yaml_escape(s: &str) -> String {
    if s.contains(':') || s.contains('#') || s.contains('"') || s.starts_with(' ') {
        format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
    } else {
        s.to_string()
    }
}
