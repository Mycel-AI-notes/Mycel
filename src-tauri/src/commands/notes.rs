use crate::core::crypto::{self, is_encrypted_path};
use crate::core::parser::{parse_note, ParsedNote};
use crate::core::vault::{
    auto_heading, is_safe_rel_path, read_tree_order, write_tree_order, KNOWLEDGE_BASE_DIR,
    QUICK_NOTES_DIR,
};
use crate::AppState;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;

fn is_protected(rel_path: &str) -> bool {
    rel_path == KNOWLEDGE_BASE_DIR || rel_path == QUICK_NOTES_DIR
}

/// Vault-relative parent of `p` (`""` for a top-level entry).
fn rel_parent(p: &str) -> String {
    match p.rfind('/') {
        Some(i) => p[..i].to_string(),
        None => String::new(),
    }
}

/// Last path segment (the entry's name) of `p`.
fn rel_name(p: &str) -> String {
    match p.rfind('/') {
        Some(i) => p[i + 1..].to_string(),
        None => p.to_string(),
    }
}

/// Hex-encoded SHA-256 of the raw on-disk bytes. We hash the ciphertext for
/// encrypted notes, not the plaintext — the goal is to detect any external
/// change to the file, not to compare semantic content.
fn hash_bytes(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    let out = h.finalize();
    let mut s = String::with_capacity(out.len() * 2);
    for b in out {
        use std::fmt::Write as _;
        let _ = write!(s, "{:02x}", b);
    }
    s
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Note {
    pub path: String,
    pub content: String,
    pub parsed: ParsedNote,
    /// True when the on-disk file was `.md.age` and we decrypted it for the
    /// caller. The frontend uses this to render a lock badge and to call
    /// `note_save` with the same path (the save path keeps `.md.age` —
    /// re-encryption is automatic).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub encrypted: bool,
    /// SHA-256 of the raw on-disk bytes at read time. The frontend passes
    /// this back to `note_save_checked` so we can refuse to silently
    /// overwrite a file that another device (or `git pull`) changed between
    /// the read and the save.
    pub disk_hash: String,
}

/// Outcome of `note_save_checked`. On `conflict` the frontend gets the
/// disk's current decrypted content + hash so it can show a 3-way resolution
/// UI (reload / keep mine / keep both / view diff) without a second roundtrip.
#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SaveResult {
    Saved {
        disk_hash: String,
    },
    Conflict {
        disk_hash: String,
        disk_content: String,
        encrypted: bool,
    },
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
    let encrypted = is_encrypted_path(&path);
    let raw = std::fs::read(&abs_path).map_err(|e| format!("Failed to read {path}: {e}"))?;
    let disk_hash = hash_bytes(&raw);
    let content = if encrypted {
        crypto::decrypt_note(&state.crypto, &raw).map_err(|e| e.to_string())?
    } else {
        String::from_utf8(raw).map_err(|e| format!("Failed to read {path}: {e}"))?
    };
    let parsed = parse_note(&content);

    Ok(Note {
        path,
        content,
        parsed,
        encrypted,
        disk_hash,
    })
}

/// Write `content` to `path` unconditionally and return the new on-disk
/// hash. Used by the conflict dialog's "Keep mine" path and by the
/// initial-create flow where there's nothing to clobber.
#[tauri::command]
pub async fn note_save(
    path: String,
    content: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let vault_root = {
        let guard = state.vault.lock().await;
        guard
            .as_ref()
            .map(|v| v.root.clone())
            .ok_or("No vault open")?
    };

    write_note(&vault_root, &path, &content).await
}

/// Write `content` only if the file on disk still hashes to
/// `expected_disk_hash`. If another device (or git pull) changed the file
/// since the user opened it, return the current disk content so the
/// frontend can show a resolution dialog. An empty `expected_disk_hash`
/// means "the file did not exist when I started editing".
#[tauri::command]
pub async fn note_save_checked(
    path: String,
    content: String,
    expected_disk_hash: String,
    state: State<'_, AppState>,
) -> Result<SaveResult, String> {
    let vault_root = {
        let guard = state.vault.lock().await;
        guard
            .as_ref()
            .map(|v| v.root.clone())
            .ok_or("No vault open")?
    };

    let abs_path = vault_root.join(&path);
    let encrypted = is_encrypted_path(&path);

    let on_disk: Option<(String, String)> = match std::fs::read(&abs_path) {
        Ok(raw) => {
            let h = hash_bytes(&raw);
            let decoded = if encrypted {
                crypto::decrypt_note(&state.crypto, &raw).map_err(|e| e.to_string())?
            } else {
                String::from_utf8(raw).map_err(|e| format!("Failed to read {path}: {e}"))?
            };
            Some((h, decoded))
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => None,
        Err(e) => return Err(format!("Failed to read {path}: {e}")),
    };

    let matches = match &on_disk {
        Some((h, _)) => h == &expected_disk_hash,
        None => expected_disk_hash.is_empty(),
    };

    if !matches {
        let (disk_hash, disk_content) = on_disk.unwrap_or_default();
        return Ok(SaveResult::Conflict {
            disk_hash,
            disk_content,
            encrypted,
        });
    }

    let disk_hash = write_note(&vault_root, &path, &content).await?;
    Ok(SaveResult::Saved { disk_hash })
}

async fn write_note(
    vault_root: &std::path::Path,
    path: &str,
    content: &str,
) -> Result<String, String> {
    let abs_path = vault_root.join(path);
    if let Some(parent) = abs_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let bytes: Vec<u8> = if is_encrypted_path(path) {
        crypto::encrypt_note(vault_root, content).map_err(|e| e.to_string())?
    } else {
        content.as_bytes().to_vec()
    };
    std::fs::write(&abs_path, &bytes).map_err(|e| e.to_string())?;
    Ok(hash_bytes(&bytes))
}

#[tauri::command]
pub async fn note_create(path: String, state: State<'_, AppState>) -> Result<Note, String> {
    let stem = std::path::Path::new(&path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("Untitled")
        // Strip the inner `.md` from `foo.md.age` so the H1 reads sensibly.
        .trim_end_matches(".md")
        .to_string();
    let initial = format!("{}\n\n", auto_heading(&stem));
    let disk_hash = note_save(path.clone(), initial.clone(), state.clone()).await?;
    let parsed = parse_note(&initial);
    Ok(Note {
        path: path.clone(),
        content: initial,
        parsed,
        encrypted: is_encrypted_path(&path),
        disk_hash,
    })
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
    if !is_safe_rel_path(&path) {
        return Err("Invalid note path".into());
    }
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

/// File a quick note into a target note: append its body as a dated section
/// with a provenance line, then delete the source (or mark it `filed_to:`).
/// The UI gates this behind an explicit confirmation dialog — see
/// `docs/specs/quick-note-filing.md`.
///
/// Returns the timestamp label used in the appended heading.
#[tauri::command]
pub async fn quick_note_merge(
    source: String,
    target: String,
    delete_source: bool,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let vault_root = {
        let guard = state.vault.lock().await;
        guard
            .as_ref()
            .map(|v| v.root.clone())
            .ok_or("No vault open")?
    };

    let timestamp =
        crate::core::quick_filing::merge(&vault_root, &source, &target, delete_source)
            .map_err(|e| e.to_string())?;

    if let Ok(ai) = crate::commands::ai::ensure_ai_state(&state).await {
        refresh_index_after_merge(&ai, &vault_root, &source, &target, delete_source).await;
    }

    Ok(timestamp)
}

/// Best-effort index maintenance after a quick-note merge: drop the deleted
/// source's chunks and re-embed the grown target. Never fails the merge —
/// the files on disk are already correct, and the next scheduled reindex
/// reconciles the index anyway.
async fn refresh_index_after_merge(
    ai: &std::sync::Arc<crate::core::ai::AiState>,
    vault_root: &std::path::Path,
    source: &str,
    target: &str,
    source_deleted: bool,
) {
    use crate::core::ai::{embedder::OpenRouterEmbedder, indexer, keyring};

    let _guard = ai.indexing.lock().await;
    if source_deleted {
        if let Err(e) = indexer::remove_note(&ai.store, source) {
            eprintln!("quick_note_merge: failed to drop {source} from index: {e:#}");
        }
    }
    let cfg = ai.config.lock().await.clone();
    if !cfg.enabled {
        return;
    }
    let Ok(Some(key)) = keyring::get_key(vault_root) else {
        return;
    };
    let embedder = OpenRouterEmbedder::new(key, cfg.embedding_model.clone());
    if let Err(e) = indexer::index_note(
        &ai.store,
        &embedder,
        vault_root,
        target,
        cfg.daily_budget_usd,
        &cfg.embedding_model,
    )
    .await
    {
        eprintln!("quick_note_merge: failed to reindex {target}: {e:#}");
    }
}

#[tauri::command]
pub async fn note_rename(old_path: String, new_path: String, state: State<'_, AppState>) -> Result<(), String> {
    if !is_safe_rel_path(&old_path) || !is_safe_rel_path(&new_path) {
        return Err("Invalid note path".into());
    }
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
    let was_dir = old_abs.is_dir();
    std::fs::rename(&old_abs, &new_abs).map_err(|e| e.to_string())?;

    // Keep the manual tree-order registry consistent with the move so the
    // user's arrangement survives renames and relocations.
    let mut order = read_tree_order(&vault_root);
    let old_parent = rel_parent(&old_path);
    let new_parent = rel_parent(&new_path);
    let old_name = rel_name(&old_path);
    let new_name = rel_name(&new_path);
    if old_parent == new_parent {
        // In-place rename: keep the entry's slot, just update its name.
        if let Some(list) = order.get_mut(&old_parent) {
            if let Some(pos) = list.iter().position(|n| n == &old_name) {
                list[pos] = new_name.clone();
            }
        }
    } else {
        // Moved to a different folder: drop it from the old parent's order.
        // The caller re-inserts it into the destination via `tree_reorder`
        // when the drop position matters.
        if let Some(list) = order.get_mut(&old_parent) {
            list.retain(|n| n != &old_name);
        }
    }
    // A moved/renamed directory carries its descendants' order keys with it:
    // re-prefix every key under `old_path` to `new_path`.
    if was_dir {
        let keys: Vec<String> = order.keys().cloned().collect();
        let prefix = format!("{old_path}/");
        for k in keys {
            if k == old_path {
                if let Some(v) = order.remove(&k) {
                    order.insert(new_path.clone(), v);
                }
            } else if let Some(rest) = k.strip_prefix(&prefix) {
                if let Some(v) = order.remove(&k) {
                    order.insert(format!("{new_path}/{rest}"), v);
                }
            }
        }
    }
    let _ = write_tree_order(&vault_root, &order);
    Ok(())
}

/// Persist the user's manual ordering of a folder's children. `parent` is the
/// vault-relative folder path (`""` for the vault root); `names` is the full
/// ordered list of child names as arranged by drag-and-drop. Names no longer
/// present on disk are harmless — the tree scan ignores them.
#[tauri::command]
pub async fn tree_reorder(
    parent: String,
    names: Vec<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let vault_root = {
        let guard = state.vault.lock().await;
        guard
            .as_ref()
            .map(|v| v.root.clone())
            .ok_or("No vault open")?
    };
    let mut order = read_tree_order(&vault_root);
    order.insert(parent, names);
    write_tree_order(&vault_root, &order).map_err(|e| e.to_string())?;
    Ok(())
}
