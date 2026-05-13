mod commands;
mod core;

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex as StdMutex};
use tokio::sync::Mutex;

pub struct AppState {
    pub vault: Arc<Mutex<Option<core::vault::Vault>>>,
    pub watcher: Arc<Mutex<Option<core::watcher::VaultWatcher>>>,
    /// In-memory holder of the unwrapped X25519 identity for the open vault.
    /// Cleared on `crypto_lock` and when the vault closes.
    pub crypto: Arc<core::crypto::Session>,
    /// Per-vault AI state: SQLite handle to `.mycel/ai/index.db` plus the
    /// loaded `AiConfig`. Lazily materialized on the first AI command so
    /// vaults that never use AI never open the DB.
    pub ai: Arc<Mutex<Option<Arc<core::ai::AiState>>>>,
    /// Per-file mutexes for database operations. Every db_* command that
    /// does read-modify-write on a .db.json acquires the lock for its path
    /// before reading; without this, two near-simultaneous commands (e.g.
    /// `db_update_cell` setting a tag and `db_create_page` setting `page`)
    /// can each read the same snapshot and the second writer clobbers the
    /// first's change — that's how the user lost their multi-select label
    /// the moment they created the page.
    pub db_locks: Arc<StdMutex<HashMap<PathBuf, Arc<Mutex<()>>>>>,
}

impl AppState {
    /// Returns the per-path mutex for a database file, creating it on first
    /// use. Use `let _guard = lock.lock().await;` around the read-modify-write
    /// sequence.
    pub fn db_lock(&self, path: &std::path::Path) -> Arc<Mutex<()>> {
        let mut map = self.db_locks.lock().expect("db_locks poisoned");
        map.entry(path.to_path_buf())
            .or_insert_with(|| Arc::new(Mutex::new(())))
            .clone()
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self {
            vault: Arc::new(Mutex::new(None)),
            watcher: Arc::new(Mutex::new(None)),
            crypto: Arc::new(core::crypto::Session::default()),
            ai: Arc::new(Mutex::new(None)),
            db_locks: Arc::new(StdMutex::new(HashMap::new())),
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
            commands::notes::note_save_checked,
            commands::notes::note_create,
            commands::notes::note_delete,
            commands::notes::note_rename,
            commands::notes::render_html,
            commands::notes::folder_create,
            commands::search::notes_list,
            commands::search::backlinks_get,
            commands::search::notes_by_tag,
            commands::graph::graph_data,
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
            commands::kb::kb_init,
            commands::kb::kb_deinit,
            commands::kb::kb_list,
            commands::kb::kb_refresh,
            commands::sync::sync_init,
            commands::sync::sync_clone,
            commands::sync::sync_now,
            commands::sync::sync_status,
            commands::sync::sync_get_config,
            commands::sync::sync_set_config,
            commands::sync::sync_disable,
            commands::sync::sync_set_token,
            commands::sync::sync_has_token,
            commands::sync::sync_clear_token,
            commands::crypto::crypto_status,
            commands::crypto::crypto_setup,
            commands::crypto::crypto_unlock,
            commands::crypto::crypto_set_passphrase,
            commands::crypto::crypto_lock,
            commands::crypto::crypto_reset,
            commands::crypto::crypto_list_recipients,
            commands::crypto::crypto_add_recipient,
            commands::crypto::crypto_remove_recipient,
            commands::crypto::note_encrypt,
            commands::crypto::note_decrypt,
            commands::crypto::note_read_ciphertext,
            commands::crypto::crypto_reencrypt_all,
            commands::garden::garden_inbox_list,
            commands::garden::garden_inbox_capture,
            commands::garden::garden_inbox_update,
            commands::garden::garden_inbox_delete,
            commands::garden::garden_inbox_process,
            commands::garden::garden_actions_list,
            commands::garden::garden_action_add,
            commands::garden::garden_action_update,
            commands::garden::garden_action_complete,
            commands::garden::garden_action_delete,
            commands::garden::garden_actions_clear_completed,
            commands::garden::garden_projects_list,
            commands::garden::garden_project_add,
            commands::garden::garden_project_update,
            commands::garden::garden_project_delete,
            commands::garden::garden_project_detail,
            commands::garden::garden_waiting_list,
            commands::garden::garden_waiting_add,
            commands::garden::garden_waiting_update,
            commands::garden::garden_waiting_complete,
            commands::garden::garden_waiting_delete,
            commands::garden::garden_waiting_clear_completed,
            commands::garden::garden_someday_list,
            commands::garden::garden_someday_add,
            commands::garden::garden_someday_update,
            commands::garden::garden_someday_delete,
            commands::garden::garden_config_get,
            commands::garden::garden_config_update,
            commands::garden::garden_counts,
            commands::garden::garden_create_page,
            commands::garden::garden_bind_page,
            commands::attachments::attachment_save_file,
            commands::attachments::attachment_save_bytes,
            commands::attachments::attachment_list,
            commands::attachments::attachment_delete,
            commands::ai::settings::ai_get_status,
            commands::ai::settings::ai_update_config,
            commands::ai::settings::ai_set_key,
            commands::ai::settings::ai_clear_key,
            commands::ai::settings::ai_test_key,
            commands::ai::index::ai_index_status,
            commands::ai::index::ai_index_bulk,
            commands::ai::index::ai_index_note,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
