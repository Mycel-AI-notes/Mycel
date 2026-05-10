mod commands;
mod core;

use std::sync::Arc;
use tokio::sync::Mutex;

pub struct AppState {
    pub vault: Arc<Mutex<Option<core::vault::Vault>>>,
    pub watcher: Arc<Mutex<Option<core::watcher::VaultWatcher>>>,
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            vault: Arc::new(Mutex::new(None)),
            watcher: Arc::new(Mutex::new(None)),
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init());

    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_global_shortcut::Builder::new().build());

    builder
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::vault::vault_open,
            commands::vault::vault_get_tree,
            commands::vault::vault_root,
            commands::notes::note_read,
            commands::notes::note_save,
            commands::notes::note_create,
            commands::notes::note_delete,
            commands::notes::note_rename,
            commands::notes::render_html,
            commands::notes::folder_create,
            commands::search::notes_list,
            commands::search::backlinks_get,
            commands::database::db_read,
            commands::database::db_write,
            commands::database::db_create,
            commands::database::db_update_cell,
            commands::database::db_add_row,
            commands::database::db_delete_row,
            commands::database::db_add_column,
            commands::database::db_delete_column,
            commands::database::db_update_column,
            commands::database::db_update_view,
            commands::database::db_create_page,
            commands::database::db_pages_dir,
            commands::database::dbs_list,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
