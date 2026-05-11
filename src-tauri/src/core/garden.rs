//! Garden — Mycel's built-in GTD system.
//!
//! Five lists live under `.mycel/garden/`, each as its own JSON file:
//! inbox, next-actions, projects, waiting-for, someday. A separate
//! `config.json` keeps user-defined contexts and view preferences.
//! The on-disk shape is intentionally simple typed JSON — readable from
//! any external tool, no schema versioning gymnastics.

use anyhow::{Context, Result};
use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

pub const GARDEN_DIR: &str = ".mycel/garden";
pub const STALE_DEFAULT_DAYS: u32 = 14;

fn now() -> DateTime<Utc> {
    Utc::now()
}

fn new_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

// ---------- Inbox ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InboxItem {
    pub id: String,
    pub text: String,
    pub captured_at: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub energy_hint: Option<String>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct InboxFile {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub items: Vec<InboxItem>,
}

// ---------- Next Actions ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ActionItem {
    pub id: String,
    pub action: String,
    #[serde(default)]
    pub context: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub energy: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub duration: Option<String>,
    #[serde(default)]
    pub done: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub done_at: Option<DateTime<Utc>>,
    pub created_at: DateTime<Utc>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page: Option<String>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct ActionsFile {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub items: Vec<ActionItem>,
}

// ---------- Projects ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectItem {
    pub id: String,
    pub title: String,
    #[serde(default)]
    pub outcome: String,
    /// "active" | "paused" | "done"
    #[serde(default = "default_status")]
    pub status: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub deadline: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub area: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page: Option<String>,
    pub created_at: DateTime<Utc>,
}

fn default_status() -> String {
    "active".to_string()
}
fn default_version() -> u32 {
    1
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct ProjectsFile {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub items: Vec<ProjectItem>,
}

// ---------- Waiting For ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WaitingItem {
    pub id: String,
    pub what: String,
    #[serde(default)]
    pub from: String,
    pub since: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub project: Option<String>,
    #[serde(default)]
    pub done: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub done_at: Option<DateTime<Utc>>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page: Option<String>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct WaitingFile {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub items: Vec<WaitingItem>,
}

// ---------- Someday ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SomedayItem {
    pub id: String,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub area: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub page: Option<String>,
    pub created_at: DateTime<Utc>,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize)]
pub struct SomedayFile {
    #[serde(default = "default_version")]
    pub version: u32,
    #[serde(default)]
    pub items: Vec<SomedayItem>,
}

// ---------- Config ----------

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GardenConfig {
    pub contexts: Vec<String>,
    pub areas: Vec<String>,
    pub waiting_for_stale_days: u32,
    pub default_grouping: String,
    pub show_completed_today: bool,
}

impl Default for GardenConfig {
    fn default() -> Self {
        Self {
            contexts: vec![
                "@компьютер".into(),
                "@звонок".into(),
                "@встреча".into(),
                "@дом".into(),
                "@магазин".into(),
                "@везде".into(),
            ],
            areas: vec![
                "work".into(),
                "personal".into(),
                "study".into(),
                "hobby".into(),
            ],
            waiting_for_stale_days: STALE_DEFAULT_DAYS,
            default_grouping: "context".into(),
            show_completed_today: true,
        }
    }
}

// ---------- Counts (for sidebar badges) ----------

#[derive(Debug, Clone, Serialize, Default)]
pub struct GardenCounts {
    pub inbox: usize,
    pub actions: usize,
    pub projects: usize,
    pub waiting: usize,
}

// ---------- I/O helpers ----------

fn garden_dir(vault_root: &Path) -> PathBuf {
    vault_root.join(GARDEN_DIR)
}

fn ensure_dir(vault_root: &Path) -> Result<PathBuf> {
    let dir = garden_dir(vault_root);
    std::fs::create_dir_all(&dir).context("Failed to create .mycel/garden directory")?;
    Ok(dir)
}

fn read_or_default<T: Default + for<'de> Deserialize<'de>>(path: &Path) -> Result<T> {
    if !path.exists() {
        return Ok(T::default());
    }
    let raw = std::fs::read_to_string(path)
        .with_context(|| format!("Failed to read {}", path.display()))?;
    if raw.trim().is_empty() {
        return Ok(T::default());
    }
    serde_json::from_str(&raw)
        .with_context(|| format!("Failed to parse {}", path.display()))
}

fn write_pretty<T: Serialize>(path: &Path, value: &T) -> Result<()> {
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(value)?;
    std::fs::write(path, json)
        .with_context(|| format!("Failed to write {}", path.display()))?;
    Ok(())
}

fn inbox_path(vault_root: &Path) -> PathBuf {
    garden_dir(vault_root).join("inbox.db.json")
}
fn actions_path(vault_root: &Path) -> PathBuf {
    garden_dir(vault_root).join("next-actions.db.json")
}
fn projects_path(vault_root: &Path) -> PathBuf {
    garden_dir(vault_root).join("projects.db.json")
}
fn waiting_path(vault_root: &Path) -> PathBuf {
    garden_dir(vault_root).join("waiting-for.db.json")
}
fn someday_path(vault_root: &Path) -> PathBuf {
    garden_dir(vault_root).join("someday.db.json")
}
fn config_path(vault_root: &Path) -> PathBuf {
    garden_dir(vault_root).join("config.json")
}

// ---- Inbox ----

pub fn read_inbox(vault_root: &Path) -> Result<InboxFile> {
    read_or_default(&inbox_path(vault_root))
}

pub fn write_inbox(vault_root: &Path, file: &InboxFile) -> Result<()> {
    ensure_dir(vault_root)?;
    write_pretty(&inbox_path(vault_root), file)
}

pub fn capture_inbox(vault_root: &Path, text: String) -> Result<String> {
    let mut f = read_inbox(vault_root)?;
    let item = InboxItem {
        id: new_id(),
        text,
        captured_at: now(),
        page: None,
        source: None,
        energy_hint: None,
    };
    let id = item.id.clone();
    f.items.push(item);
    write_inbox(vault_root, &f)?;
    Ok(id)
}

/// Each Optional field on an `*Update` carries change-or-leave semantics:
/// `Some(x)` overwrites, `None` leaves the existing value alone. To clear a
/// nullable field on disk (e.g. unbind a page), call `bind_page` instead.
#[derive(Debug, Default, Deserialize)]
pub struct InboxUpdate {
    pub text: Option<String>,
    pub page: Option<String>,
    pub source: Option<String>,
    pub energy_hint: Option<String>,
}

pub fn update_inbox(vault_root: &Path, id: &str, u: InboxUpdate) -> Result<()> {
    let mut f = read_inbox(vault_root)?;
    let item = f
        .items
        .iter_mut()
        .find(|i| i.id == id)
        .with_context(|| format!("Inbox item {id} not found"))?;
    if let Some(t) = u.text {
        item.text = t;
    }
    if let Some(p) = u.page {
        item.page = Some(p);
    }
    if let Some(s) = u.source {
        item.source = Some(s);
    }
    if let Some(e) = u.energy_hint {
        item.energy_hint = Some(e);
    }
    write_inbox(vault_root, &f)
}

pub fn delete_inbox(vault_root: &Path, id: &str) -> Result<()> {
    let mut f = read_inbox(vault_root)?;
    f.items.retain(|i| i.id != id);
    write_inbox(vault_root, &f)
}

// ---- Actions ----

pub fn read_actions(vault_root: &Path) -> Result<ActionsFile> {
    read_or_default(&actions_path(vault_root))
}

pub fn write_actions(vault_root: &Path, file: &ActionsFile) -> Result<()> {
    ensure_dir(vault_root)?;
    write_pretty(&actions_path(vault_root), file)
}

#[derive(Debug, Default, Deserialize)]
pub struct NewAction {
    pub action: String,
    #[serde(default)]
    pub context: String,
    pub project: Option<String>,
    pub energy: Option<String>,
    pub duration: Option<String>,
    pub page: Option<String>,
}

pub fn add_action(vault_root: &Path, n: NewAction) -> Result<String> {
    let mut f = read_actions(vault_root)?;
    let item = ActionItem {
        id: new_id(),
        action: n.action,
        context: if n.context.is_empty() {
            "@везде".into()
        } else {
            n.context
        },
        project: n.project,
        energy: n.energy,
        duration: n.duration,
        done: false,
        done_at: None,
        created_at: now(),
        page: n.page,
    };
    let id = item.id.clone();
    f.items.push(item);
    write_actions(vault_root, &f)?;
    Ok(id)
}

#[derive(Debug, Default, Deserialize)]
pub struct ActionUpdate {
    pub action: Option<String>,
    pub context: Option<String>,
    pub project: Option<String>,
    pub energy: Option<String>,
    pub duration: Option<String>,
    pub page: Option<String>,
}

pub fn update_action(vault_root: &Path, id: &str, u: ActionUpdate) -> Result<()> {
    let mut f = read_actions(vault_root)?;
    let item = f
        .items
        .iter_mut()
        .find(|i| i.id == id)
        .with_context(|| format!("Action {id} not found"))?;
    if let Some(a) = u.action {
        item.action = a;
    }
    if let Some(c) = u.context {
        item.context = c;
    }
    if let Some(p) = u.project {
        item.project = Some(p);
    }
    if let Some(e) = u.energy {
        item.energy = Some(e);
    }
    if let Some(d) = u.duration {
        item.duration = Some(d);
    }
    if let Some(pg) = u.page {
        item.page = Some(pg);
    }
    write_actions(vault_root, &f)
}

pub fn complete_action(vault_root: &Path, id: &str, done: bool) -> Result<()> {
    let mut f = read_actions(vault_root)?;
    let item = f
        .items
        .iter_mut()
        .find(|i| i.id == id)
        .with_context(|| format!("Action {id} not found"))?;
    item.done = done;
    item.done_at = if done { Some(now()) } else { None };
    write_actions(vault_root, &f)
}

pub fn delete_action(vault_root: &Path, id: &str) -> Result<()> {
    let mut f = read_actions(vault_root)?;
    f.items.retain(|i| i.id != id);
    write_actions(vault_root, &f)
}

/// Drop every completed action. Returns how many rows were removed.
pub fn clear_completed_actions(vault_root: &Path) -> Result<usize> {
    let mut f = read_actions(vault_root)?;
    let before = f.items.len();
    f.items.retain(|i| !i.done);
    let removed = before - f.items.len();
    write_actions(vault_root, &f)?;
    Ok(removed)
}

// ---- Projects ----

pub fn read_projects(vault_root: &Path) -> Result<ProjectsFile> {
    read_or_default(&projects_path(vault_root))
}

pub fn write_projects(vault_root: &Path, file: &ProjectsFile) -> Result<()> {
    ensure_dir(vault_root)?;
    write_pretty(&projects_path(vault_root), file)
}

#[derive(Debug, Default, Deserialize)]
pub struct NewProject {
    pub title: String,
    #[serde(default)]
    pub outcome: String,
    pub deadline: Option<String>,
    pub area: Option<String>,
    pub page: Option<String>,
}

pub fn add_project(vault_root: &Path, n: NewProject) -> Result<String> {
    let mut f = read_projects(vault_root)?;
    let item = ProjectItem {
        id: new_id(),
        title: n.title,
        outcome: n.outcome,
        status: "active".into(),
        deadline: n.deadline,
        area: n.area,
        page: n.page,
        created_at: now(),
    };
    let id = item.id.clone();
    f.items.push(item);
    write_projects(vault_root, &f)?;
    Ok(id)
}

#[derive(Debug, Default, Deserialize)]
pub struct ProjectUpdate {
    pub title: Option<String>,
    pub outcome: Option<String>,
    pub status: Option<String>,
    pub deadline: Option<String>,
    pub area: Option<String>,
    pub page: Option<String>,
}

pub fn update_project(vault_root: &Path, id: &str, u: ProjectUpdate) -> Result<()> {
    let mut projects = read_projects(vault_root)?;
    let project = projects
        .items
        .iter_mut()
        .find(|i| i.id == id)
        .with_context(|| format!("Project {id} not found"))?;
    let old_title = project.title.clone();
    if let Some(t) = u.title.clone() {
        project.title = t;
    }
    if let Some(o) = u.outcome {
        project.outcome = o;
    }
    if let Some(s) = u.status {
        project.status = s;
    }
    if let Some(d) = u.deadline {
        project.deadline = Some(d);
    }
    if let Some(a) = u.area {
        project.area = Some(a);
    }
    if let Some(p) = u.page {
        project.page = Some(p);
    }
    let new_title = project.title.clone();
    write_projects(vault_root, &projects)?;

    // Cascade rename to actions and waiting-for.
    if let Some(_t) = u.title {
        if old_title != new_title {
            let mut actions = read_actions(vault_root)?;
            let mut touched = false;
            for a in actions.items.iter_mut() {
                if a.project.as_deref() == Some(old_title.as_str()) {
                    a.project = Some(new_title.clone());
                    touched = true;
                }
            }
            if touched {
                write_actions(vault_root, &actions)?;
            }
            let mut waiting = read_waiting(vault_root)?;
            let mut touched_w = false;
            for w in waiting.items.iter_mut() {
                if w.project.as_deref() == Some(old_title.as_str()) {
                    w.project = Some(new_title.clone());
                    touched_w = true;
                }
            }
            if touched_w {
                write_waiting(vault_root, &waiting)?;
            }
        }
    }
    Ok(())
}

pub fn delete_project(vault_root: &Path, id: &str) -> Result<()> {
    let mut f = read_projects(vault_root)?;
    f.items.retain(|i| i.id != id);
    write_projects(vault_root, &f)
}

// ---- Waiting For ----

pub fn read_waiting(vault_root: &Path) -> Result<WaitingFile> {
    read_or_default(&waiting_path(vault_root))
}

pub fn write_waiting(vault_root: &Path, file: &WaitingFile) -> Result<()> {
    ensure_dir(vault_root)?;
    write_pretty(&waiting_path(vault_root), file)
}

#[derive(Debug, Default, Deserialize)]
pub struct NewWaiting {
    pub what: String,
    #[serde(default)]
    pub from: String,
    pub since: Option<String>,
    pub project: Option<String>,
    pub page: Option<String>,
}

pub fn add_waiting(vault_root: &Path, n: NewWaiting) -> Result<String> {
    let mut f = read_waiting(vault_root)?;
    let item = WaitingItem {
        id: new_id(),
        what: n.what,
        from: n.from,
        since: n.since.unwrap_or_else(|| now().date_naive().to_string()),
        project: n.project,
        done: false,
        done_at: None,
        page: n.page,
    };
    let id = item.id.clone();
    f.items.push(item);
    write_waiting(vault_root, &f)?;
    Ok(id)
}

#[derive(Debug, Default, Deserialize)]
pub struct WaitingUpdate {
    pub what: Option<String>,
    pub from: Option<String>,
    pub since: Option<String>,
    pub project: Option<String>,
    pub page: Option<String>,
}

pub fn update_waiting(vault_root: &Path, id: &str, u: WaitingUpdate) -> Result<()> {
    let mut f = read_waiting(vault_root)?;
    let item = f
        .items
        .iter_mut()
        .find(|i| i.id == id)
        .with_context(|| format!("Waiting item {id} not found"))?;
    if let Some(w) = u.what {
        item.what = w;
    }
    if let Some(fr) = u.from {
        item.from = fr;
    }
    if let Some(s) = u.since {
        item.since = s;
    }
    if let Some(p) = u.project {
        item.project = Some(p);
    }
    if let Some(pg) = u.page {
        item.page = Some(pg);
    }
    write_waiting(vault_root, &f)
}

pub fn complete_waiting(vault_root: &Path, id: &str, done: bool) -> Result<()> {
    let mut f = read_waiting(vault_root)?;
    let item = f
        .items
        .iter_mut()
        .find(|i| i.id == id)
        .with_context(|| format!("Waiting item {id} not found"))?;
    item.done = done;
    item.done_at = if done { Some(now()) } else { None };
    write_waiting(vault_root, &f)
}

pub fn delete_waiting(vault_root: &Path, id: &str) -> Result<()> {
    let mut f = read_waiting(vault_root)?;
    f.items.retain(|i| i.id != id);
    write_waiting(vault_root, &f)
}

/// Drop every received waiting-for item. Returns how many rows were removed.
pub fn clear_completed_waiting(vault_root: &Path) -> Result<usize> {
    let mut f = read_waiting(vault_root)?;
    let before = f.items.len();
    f.items.retain(|i| !i.done);
    let removed = before - f.items.len();
    write_waiting(vault_root, &f)?;
    Ok(removed)
}

// ---- Someday ----

pub fn read_someday(vault_root: &Path) -> Result<SomedayFile> {
    read_or_default(&someday_path(vault_root))
}

pub fn write_someday(vault_root: &Path, file: &SomedayFile) -> Result<()> {
    ensure_dir(vault_root)?;
    write_pretty(&someday_path(vault_root), file)
}

#[derive(Debug, Default, Deserialize)]
pub struct NewSomeday {
    pub text: String,
    pub area: Option<String>,
    pub page: Option<String>,
}

pub fn add_someday(vault_root: &Path, n: NewSomeday) -> Result<String> {
    let mut f = read_someday(vault_root)?;
    let item = SomedayItem {
        id: new_id(),
        text: n.text,
        area: n.area,
        page: n.page,
        created_at: now(),
    };
    let id = item.id.clone();
    f.items.push(item);
    write_someday(vault_root, &f)?;
    Ok(id)
}

#[derive(Debug, Default, Deserialize)]
pub struct SomedayUpdate {
    pub text: Option<String>,
    pub area: Option<String>,
    pub page: Option<String>,
}

pub fn update_someday(vault_root: &Path, id: &str, u: SomedayUpdate) -> Result<()> {
    let mut f = read_someday(vault_root)?;
    let item = f
        .items
        .iter_mut()
        .find(|i| i.id == id)
        .with_context(|| format!("Someday item {id} not found"))?;
    if let Some(t) = u.text {
        item.text = t;
    }
    if let Some(a) = u.area {
        item.area = Some(a);
    }
    if let Some(p) = u.page {
        item.page = Some(p);
    }
    write_someday(vault_root, &f)
}

pub fn delete_someday(vault_root: &Path, id: &str) -> Result<()> {
    let mut f = read_someday(vault_root)?;
    f.items.retain(|i| i.id != id);
    write_someday(vault_root, &f)
}

// ---- Config ----

pub fn read_config(vault_root: &Path) -> Result<GardenConfig> {
    let path = config_path(vault_root);
    if !path.exists() {
        let cfg = GardenConfig::default();
        ensure_dir(vault_root)?;
        write_pretty(&path, &cfg)?;
        return Ok(cfg);
    }
    let raw = std::fs::read_to_string(&path)?;
    Ok(serde_json::from_str(&raw).unwrap_or_default())
}

pub fn write_config(vault_root: &Path, cfg: &GardenConfig) -> Result<()> {
    ensure_dir(vault_root)?;
    write_pretty(&config_path(vault_root), cfg)
}

// ---- Counts ----

pub fn counts(vault_root: &Path) -> Result<GardenCounts> {
    let inbox = read_inbox(vault_root)?.items.len();
    let actions = read_actions(vault_root)?
        .items
        .iter()
        .filter(|a| !a.done)
        .count();
    let projects = read_projects(vault_root)?
        .items
        .iter()
        .filter(|p| p.status == "active")
        .count();
    let waiting = read_waiting(vault_root)?
        .items
        .iter()
        .filter(|w| !w.done)
        .count();
    Ok(GardenCounts {
        inbox,
        actions,
        projects,
        waiting,
    })
}

// ---- Reference (process to vault note) ----

/// Create a markdown note in the vault at `note_path` containing the inbox
/// item's text. Returns the path that was written.
pub fn create_reference_note(
    vault_root: &Path,
    note_path: &str,
    title: &str,
    body: &str,
) -> Result<()> {
    let abs = vault_root.join(note_path);
    if let Some(parent) = abs.parent() {
        std::fs::create_dir_all(parent)?;
    }
    if abs.exists() {
        anyhow::bail!("File already exists: {}", note_path);
    }
    let content = format!(
        "---\ntitle: {}\n---\n\n# {}\n\n{}\n",
        yaml_escape(title),
        title,
        body
    );
    std::fs::write(&abs, content)?;
    Ok(())
}

fn yaml_escape(s: &str) -> String {
    if s.contains(':') || s.contains('#') || s.contains('"') || s.starts_with(' ') {
        format!("\"{}\"", s.replace('\\', "\\\\").replace('"', "\\\""))
    } else {
        s.to_string()
    }
}

/// Bind a vault page to a garden item, or clear the binding by passing
/// `None`. The caller writes the file and records the relative path here.
pub fn bind_page(
    vault_root: &Path,
    list: &str,
    item_id: &str,
    note_path: Option<String>,
) -> Result<()> {
    match list {
        "inbox" => {
            let mut f = read_inbox(vault_root)?;
            let item = f
                .items
                .iter_mut()
                .find(|i| i.id == item_id)
                .with_context(|| format!("Inbox item {item_id} not found"))?;
            item.page = note_path;
            write_inbox(vault_root, &f)
        }
        "actions" => {
            let mut f = read_actions(vault_root)?;
            let item = f
                .items
                .iter_mut()
                .find(|i| i.id == item_id)
                .with_context(|| format!("Action {item_id} not found"))?;
            item.page = note_path;
            write_actions(vault_root, &f)
        }
        "projects" => {
            let mut f = read_projects(vault_root)?;
            let item = f
                .items
                .iter_mut()
                .find(|i| i.id == item_id)
                .with_context(|| format!("Project {item_id} not found"))?;
            item.page = note_path;
            write_projects(vault_root, &f)
        }
        "waiting" => {
            let mut f = read_waiting(vault_root)?;
            let item = f
                .items
                .iter_mut()
                .find(|i| i.id == item_id)
                .with_context(|| format!("Waiting item {item_id} not found"))?;
            item.page = note_path;
            write_waiting(vault_root, &f)
        }
        "someday" => {
            let mut f = read_someday(vault_root)?;
            let item = f
                .items
                .iter_mut()
                .find(|i| i.id == item_id)
                .with_context(|| format!("Someday item {item_id} not found"))?;
            item.page = note_path;
            write_someday(vault_root, &f)
        }
        other => anyhow::bail!("Unknown garden list '{other}'"),
    }
}
