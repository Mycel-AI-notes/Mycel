//! Tauri commands that expose the per-note crypto feature to the frontend.
//!
//! All file-system writes go through the same path as plaintext notes — the
//! only difference is the suffix (`.md` → `.md.age`) and the wrap/unwrap step
//! we apply in-memory.

use std::path::PathBuf;

use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Emitter, State};
use zeroize::Zeroizing;

use crate::core::crypto::{
    self, decrypted_path_for, encrypted_path_for, is_encrypted_path, CryptoStatus,
};
use crate::AppState;

fn err(e: impl std::fmt::Display) -> String {
    e.to_string()
}

async fn vault_root(state: &State<'_, AppState>) -> Result<PathBuf, String> {
    let guard = state.vault.lock().await;
    guard
        .as_ref()
        .map(|v| v.root.clone())
        .ok_or_else(|| "No vault open".to_string())
}

#[tauri::command]
pub async fn crypto_status(state: State<'_, AppState>) -> Result<CryptoStatus, String> {
    let root = vault_root(&state).await?;
    crypto::status(&root, &state.crypto).map_err(err)
}

#[derive(Debug, Deserialize)]
pub struct PassphraseArg {
    pub passphrase: String,
}

#[tauri::command]
pub async fn crypto_setup(
    args: PassphraseArg,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let root = vault_root(&state).await?;
    let pass = Zeroizing::new(args.passphrase);
    crypto::setup(&root, &state.crypto, &pass).map_err(err)
}

#[tauri::command]
pub async fn crypto_unlock(
    args: PassphraseArg,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let root = vault_root(&state).await?;
    // Wrap the passphrase in `Zeroizing` so the heap buffer holding it is
    // overwritten when this scope exits, rather than left lying around until
    // the allocator decides to reuse the memory.
    let pass = Zeroizing::new(args.passphrase);
    // Emit a progress event between major steps so the unlock dialog can
    // show real "doing X…" labels while scrypt grinds — without this the
    // UI just spins for 1–3s with no signal that anything is happening.
    let on_stage = |stage: &str| {
        let _ = app.emit("crypto:unlock-stage", stage);
    };
    state.crypto.unlock(&root, &pass, &on_stage).map_err(err)
}

/// Upgrade a passphrase-less vault (or change the passphrase on a
/// double-wrap one) without rotating the X25519 secret. Requires the
/// vault to be currently unlocked.
#[tauri::command]
pub async fn crypto_set_passphrase(
    args: PassphraseArg,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let root = vault_root(&state).await?;
    let pass = Zeroizing::new(args.passphrase);
    crypto::set_passphrase(&root, &state.crypto, &pass).map_err(err)
}

#[tauri::command]
pub async fn crypto_lock(state: State<'_, AppState>) -> Result<(), String> {
    state.crypto.lock();
    Ok(())
}

#[tauri::command]
pub async fn crypto_reset(state: State<'_, AppState>) -> Result<(), String> {
    let root = vault_root(&state).await?;
    crypto::reset(&root, &state.crypto).map_err(err)
}

#[tauri::command]
pub async fn crypto_list_recipients(
    state: State<'_, AppState>,
) -> Result<Vec<String>, String> {
    let root = vault_root(&state).await?;
    crypto::read_recipients(&root).map_err(err)
}

#[derive(Debug, Deserialize)]
pub struct RecipientArg {
    pub recipient: String,
}

#[tauri::command]
pub async fn crypto_add_recipient(
    args: RecipientArg,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let root = vault_root(&state).await?;
    crypto::add_recipient(&root, &args.recipient).map_err(err)
}

#[tauri::command]
pub async fn crypto_remove_recipient(
    args: RecipientArg,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let root = vault_root(&state).await?;
    crypto::remove_recipient(&root, &args.recipient).map_err(err)
}

/// Encrypt an existing plaintext `.md` note in place: read, encrypt, write
/// `<name>.md.age`, then delete the plaintext. Returns the new path.
#[derive(Debug, Serialize, Deserialize)]
pub struct EncryptResult {
    pub path: String,
}

#[tauri::command]
pub async fn note_encrypt(
    path: String,
    state: State<'_, AppState>,
) -> Result<EncryptResult, String> {
    if is_encrypted_path(&path) {
        return Err("Note is already encrypted".into());
    }
    let root = vault_root(&state).await?;
    let src = root.join(&path);
    let plaintext = std::fs::read_to_string(&src)
        .map_err(|e| format!("Failed to read {path}: {e}"))?;
    let cipher = crypto::encrypt_note(&root, &plaintext).map_err(err)?;

    let new_rel = encrypted_path_for(&path);
    let dst = root.join(&new_rel);
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&dst, &cipher).map_err(|e| e.to_string())?;
    // Only remove the plaintext after the ciphertext is on disk — otherwise a
    // mid-operation crash would lose the note entirely.
    if src != dst {
        std::fs::remove_file(&src).map_err(|e| e.to_string())?;
    }
    Ok(EncryptResult { path: new_rel })
}

/// Decrypt an encrypted `.md.age` note in place to a plaintext `.md`.
/// Requires the session to be unlocked.
#[tauri::command]
pub async fn note_decrypt(
    path: String,
    state: State<'_, AppState>,
) -> Result<EncryptResult, String> {
    if !is_encrypted_path(&path) {
        return Err("Note is not encrypted".into());
    }
    let root = vault_root(&state).await?;
    let src = root.join(&path);
    let cipher = std::fs::read(&src).map_err(|e| format!("Failed to read {path}: {e}"))?;
    let plaintext = crypto::decrypt_note(&state.crypto, &cipher).map_err(err)?;

    let new_rel = decrypted_path_for(&path);
    let dst = root.join(&new_rel);
    if let Some(parent) = dst.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    std::fs::write(&dst, plaintext).map_err(|e| e.to_string())?;
    if src != dst {
        std::fs::remove_file(&src).map_err(|e| e.to_string())?;
    }
    Ok(EncryptResult { path: new_rel })
}

/// Rewrap every `*.md.age` in the vault so it includes the current
/// recipient set. Used after a new device joins so notes that predate
/// the join become readable on it. Requires the vault to be unlocked.
#[tauri::command]
pub async fn crypto_reencrypt_all(
    state: State<'_, AppState>,
) -> Result<crate::core::crypto::ReencryptReport, String> {
    let root = vault_root(&state).await?;
    crypto::reencrypt_all(&root, &state.crypto).map_err(err)
}

/// Return the on-disk ciphertext of an encrypted note as UTF-8 text.
/// This is the armored age blob (`-----BEGIN AGE ENCRYPTED FILE-----…`)
/// and does NOT require the vault to be unlocked — it's just a file
/// read. The UI uses this to show "this is what GitHub / iCloud actually
/// see for this note".
#[tauri::command]
pub async fn note_read_ciphertext(
    path: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    if !is_encrypted_path(&path) {
        return Err("Note is not encrypted".into());
    }
    let root = vault_root(&state).await?;
    let bytes =
        std::fs::read(root.join(&path)).map_err(|e| format!("Failed to read {path}: {e}"))?;
    String::from_utf8(bytes).map_err(|e| format!("File is not valid UTF-8: {e}"))
}
