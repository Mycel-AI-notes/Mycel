use crate::core::crypto::{self, is_encrypted_path};
use crate::core::parser::{parse_note, ParsedNote};
use crate::core::vault::{KNOWLEDGE_BASE_DIR, QUICK_NOTES_DIR};
use crate::AppState;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;

fn is_protected(rel_path: &str) -> bool {
    rel_path == KNOWLEDGE_BASE_DIR || rel_path == QUICK_NOTES_DIR
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
    let initial = format!("# {stem}\n\n");
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

fn copy_dir_recursive(src: &std::path::Path, dest: &std::path::Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dest)?;
    for entry in std::fs::read_dir(src)? {
        let entry = entry?;
        let target = dest.join(entry.file_name());
        if entry.file_type()?.is_dir() {
            copy_dir_recursive(&entry.path(), &target)?;
        } else {
            std::fs::copy(entry.path(), target)?;
        }
    }
    Ok(())
}

#[tauri::command]
pub async fn note_copy(
    src_path: String,
    dest_path: String,
    state: State<'_, AppState>,
) -> Result<(), String> {
    if is_protected(&src_path) {
        return Err("This folder is managed by Mycel and cannot be copied".into());
    }
    let vault_root = {
        let guard = state.vault.lock().await;
        guard
            .as_ref()
            .map(|v| v.root.clone())
            .ok_or("No vault open")?
    };
    let src_abs = vault_root.join(&src_path);
    let dest_abs = vault_root.join(&dest_path);
    if dest_abs.exists() {
        return Err("Destination already exists".into());
    }
    if let Some(parent) = dest_abs.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    if src_abs.is_dir() {
        copy_dir_recursive(&src_abs, &dest_abs).map_err(|e| e.to_string())?;
    } else {
        std::fs::copy(&src_abs, &dest_abs).map_err(|e| e.to_string())?;
    }
    Ok(())
}
