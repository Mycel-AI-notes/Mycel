use crate::core::garden::{self as g, GardenConfig, GardenCounts};
use crate::AppState;
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use tauri::State;

async fn vault_root(state: &State<'_, AppState>) -> Result<PathBuf, String> {
    let guard = state.vault.lock().await;
    guard
        .as_ref()
        .map(|v| v.root.clone())
        .ok_or_else(|| "No vault open".to_string())
}

fn map_err<T>(r: anyhow::Result<T>) -> Result<T, String> {
    r.map_err(|e| e.to_string())
}

// ---------- Inbox ----------

#[tauri::command]
pub async fn garden_inbox_list(
    state: State<'_, AppState>,
) -> Result<Vec<g::InboxItem>, String> {
    let root = vault_root(&state).await?;
    let f = map_err(g::read_inbox(&root))?;
    Ok(f.items)
}

#[tauri::command]
pub async fn garden_inbox_capture(
    text: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let root = vault_root(&state).await?;
    map_err(g::capture_inbox(&root, text))
}

#[tauri::command]
pub async fn garden_inbox_update(
    id: String,
    updates: g::InboxUpdate,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let root = vault_root(&state).await?;
    map_err(g::update_inbox(&root, &id, updates))
}

#[tauri::command]
pub async fn garden_inbox_delete(
    id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let root = vault_root(&state).await?;
    map_err(g::delete_inbox(&root, &id))
}

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ProcessTarget {
    NextAction {
        context: Option<String>,
        project: Option<String>,
        energy: Option<String>,
        duration: Option<String>,
    },
    Project {
        outcome: Option<String>,
        first_action: Option<String>,
        action_context: Option<String>,
    },
    WaitingFor {
        from: Option<String>,
        project: Option<String>,
    },
    Someday {
        area: Option<String>,
    },
    Reference {
        note_path: String,
    },
    Trash,
}

#[derive(Debug, Serialize)]
pub struct ProcessResult {
    pub created_id: Option<String>,
    pub created_action_id: Option<String>,
    pub created_note: Option<String>,
}

#[tauri::command]
pub async fn garden_inbox_process(
    id: String,
    target: ProcessTarget,
    state: State<'_, AppState>,
) -> Result<ProcessResult, String> {
    let root = vault_root(&state).await?;
    let inbox = map_err(g::read_inbox(&root))?;
    let item = inbox
        .items
        .iter()
        .find(|i| i.id == id)
        .ok_or_else(|| format!("Inbox item {id} not found"))?
        .clone();

    let mut out = ProcessResult {
        created_id: None,
        created_action_id: None,
        created_note: None,
    };

    match target {
        ProcessTarget::NextAction {
            context,
            project,
            energy,
            duration,
        } => {
            let new_id = map_err(g::add_action(
                &root,
                g::NewAction {
                    action: item.text.clone(),
                    context: context.unwrap_or_else(|| "@везде".into()),
                    project,
                    energy,
                    duration,
                    page: item.page.clone(),
                },
            ))?;
            out.created_id = Some(new_id);
        }
        ProcessTarget::Project {
            outcome,
            first_action,
            action_context,
        } => {
            let title = item.text.clone();
            let proj_id = map_err(g::add_project(
                &root,
                g::NewProject {
                    title: title.clone(),
                    outcome: outcome.unwrap_or_default(),
                    deadline: None,
                    area: None,
                    page: item.page.clone(),
                },
            ))?;
            out.created_id = Some(proj_id);
            if let Some(action_text) = first_action.filter(|s| !s.trim().is_empty()) {
                let aid = map_err(g::add_action(
                    &root,
                    g::NewAction {
                        action: action_text,
                        context: action_context.unwrap_or_else(|| "@везде".into()),
                        project: Some(title),
                        energy: None,
                        duration: None,
                        page: None,
                    },
                ))?;
                out.created_action_id = Some(aid);
            }
        }
        ProcessTarget::WaitingFor { from, project } => {
            let new_id = map_err(g::add_waiting(
                &root,
                g::NewWaiting {
                    what: item.text.clone(),
                    from: from.unwrap_or_default(),
                    since: None,
                    project,
                    page: item.page.clone(),
                },
            ))?;
            out.created_id = Some(new_id);
        }
        ProcessTarget::Someday { area } => {
            let new_id = map_err(g::add_someday(
                &root,
                g::NewSomeday {
                    text: item.text.clone(),
                    area,
                    page: item.page.clone(),
                },
            ))?;
            out.created_id = Some(new_id);
        }
        ProcessTarget::Reference { note_path } => {
            let title = item.text.lines().next().unwrap_or("Note").to_string();
            map_err(g::create_reference_note(&root, &note_path, &title, ""))?;
            out.created_note = Some(note_path);
        }
        ProcessTarget::Trash => {}
    }

    map_err(g::delete_inbox(&root, &id))?;
    Ok(out)
}

// ---------- Actions ----------

#[tauri::command]
pub async fn garden_actions_list(
    state: State<'_, AppState>,
) -> Result<Vec<g::ActionItem>, String> {
    let root = vault_root(&state).await?;
    let f = map_err(g::read_actions(&root))?;
    Ok(f.items)
}

#[tauri::command]
pub async fn garden_action_add(
    item: g::NewAction,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let root = vault_root(&state).await?;
    map_err(g::add_action(&root, item))
}

#[tauri::command]
pub async fn garden_action_update(
    id: String,
    updates: g::ActionUpdate,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let root = vault_root(&state).await?;
    map_err(g::update_action(&root, &id, updates))
}

#[tauri::command]
pub async fn garden_action_complete(
    id: String,
    done: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let root = vault_root(&state).await?;
    map_err(g::complete_action(&root, &id, done))
}

#[tauri::command]
pub async fn garden_action_delete(
    id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let root = vault_root(&state).await?;
    map_err(g::delete_action(&root, &id))
}

#[tauri::command]
pub async fn garden_actions_clear_completed(
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let root = vault_root(&state).await?;
    map_err(g::clear_completed_actions(&root))
}

// ---------- Projects ----------

#[tauri::command]
pub async fn garden_projects_list(
    state: State<'_, AppState>,
) -> Result<Vec<g::ProjectItem>, String> {
    let root = vault_root(&state).await?;
    let f = map_err(g::read_projects(&root))?;
    Ok(f.items)
}

#[tauri::command]
pub async fn garden_project_add(
    item: g::NewProject,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let root = vault_root(&state).await?;
    map_err(g::add_project(&root, item))
}

#[tauri::command]
pub async fn garden_project_update(
    id: String,
    updates: g::ProjectUpdate,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let root = vault_root(&state).await?;
    map_err(g::update_project(&root, &id, updates))
}

#[tauri::command]
pub async fn garden_project_delete(
    id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let root = vault_root(&state).await?;
    map_err(g::delete_project(&root, &id))
}

#[derive(Debug, Serialize)]
pub struct ProjectDetail {
    pub project: g::ProjectItem,
    pub actions: Vec<g::ActionItem>,
    pub waiting: Vec<g::WaitingItem>,
}

#[tauri::command]
pub async fn garden_project_detail(
    id: String,
    state: State<'_, AppState>,
) -> Result<ProjectDetail, String> {
    let root = vault_root(&state).await?;
    let projects = map_err(g::read_projects(&root))?;
    let project = projects
        .items
        .into_iter()
        .find(|p| p.id == id)
        .ok_or_else(|| format!("Project {id} not found"))?;
    let title = project.title.clone();
    let actions = map_err(g::read_actions(&root))?
        .items
        .into_iter()
        .filter(|a| a.project.as_deref() == Some(title.as_str()))
        .collect();
    let waiting = map_err(g::read_waiting(&root))?
        .items
        .into_iter()
        .filter(|w| w.project.as_deref() == Some(title.as_str()))
        .collect();
    Ok(ProjectDetail {
        project,
        actions,
        waiting,
    })
}

// ---------- Waiting For ----------

#[tauri::command]
pub async fn garden_waiting_list(
    state: State<'_, AppState>,
) -> Result<Vec<g::WaitingItem>, String> {
    let root = vault_root(&state).await?;
    let f = map_err(g::read_waiting(&root))?;
    Ok(f.items)
}

#[tauri::command]
pub async fn garden_waiting_add(
    item: g::NewWaiting,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let root = vault_root(&state).await?;
    map_err(g::add_waiting(&root, item))
}

#[tauri::command]
pub async fn garden_waiting_update(
    id: String,
    updates: g::WaitingUpdate,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let root = vault_root(&state).await?;
    map_err(g::update_waiting(&root, &id, updates))
}

#[tauri::command]
pub async fn garden_waiting_complete(
    id: String,
    done: bool,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let root = vault_root(&state).await?;
    map_err(g::complete_waiting(&root, &id, done))
}

#[tauri::command]
pub async fn garden_waiting_delete(
    id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let root = vault_root(&state).await?;
    map_err(g::delete_waiting(&root, &id))
}

#[tauri::command]
pub async fn garden_waiting_clear_completed(
    state: State<'_, AppState>,
) -> Result<usize, String> {
    let root = vault_root(&state).await?;
    map_err(g::clear_completed_waiting(&root))
}

// ---------- Someday ----------

#[tauri::command]
pub async fn garden_someday_list(
    state: State<'_, AppState>,
) -> Result<Vec<g::SomedayItem>, String> {
    let root = vault_root(&state).await?;
    let f = map_err(g::read_someday(&root))?;
    Ok(f.items)
}

#[tauri::command]
pub async fn garden_someday_add(
    item: g::NewSomeday,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let root = vault_root(&state).await?;
    map_err(g::add_someday(&root, item))
}

#[tauri::command]
pub async fn garden_someday_update(
    id: String,
    updates: g::SomedayUpdate,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let root = vault_root(&state).await?;
    map_err(g::update_someday(&root, &id, updates))
}

#[tauri::command]
pub async fn garden_someday_delete(
    id: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let root = vault_root(&state).await?;
    map_err(g::delete_someday(&root, &id))
}

// ---------- Config / Counts ----------

#[tauri::command]
pub async fn garden_config_get(
    state: State<'_, AppState>,
) -> Result<GardenConfig, String> {
    let root = vault_root(&state).await?;
    map_err(g::read_config(&root))
}

#[tauri::command]
pub async fn garden_config_update(
    config: GardenConfig,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let root = vault_root(&state).await?;
    map_err(g::write_config(&root, &config))
}

#[tauri::command]
pub async fn garden_counts(state: State<'_, AppState>) -> Result<GardenCounts, String> {
    let root = vault_root(&state).await?;
    map_err(g::counts(&root))
}

// ---------- Page binding ----------

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GardenList {
    Inbox,
    Actions,
    Projects,
    Waiting,
    Someday,
}

impl GardenList {
    fn key(&self) -> &'static str {
        match self {
            Self::Inbox => "inbox",
            Self::Actions => "actions",
            Self::Projects => "projects",
            Self::Waiting => "waiting",
            Self::Someday => "someday",
        }
    }
}

#[tauri::command]
pub async fn garden_create_page(
    list: GardenList,
    item_id: String,
    note_path: String,
    title: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let root = vault_root(&state).await?;
    map_err(g::create_reference_note(&root, &note_path, &title, ""))?;
    map_err(g::bind_page(&root, list.key(), &item_id, Some(note_path)))
}

#[tauri::command]
pub async fn garden_bind_page(
    list: GardenList,
    item_id: String,
    note_path: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let root = vault_root(&state).await?;
    map_err(g::bind_page(&root, list.key(), &item_id, note_path))
}
