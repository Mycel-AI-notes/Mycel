use crate::core::vault::ATTACHMENTS_DIR;
use crate::AppState;
use chrono::Local;
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::State;

/// Image formats the editor renders inline. We mirror the spec's list and
/// fall back to a generic write for anything else the user explicitly
/// passes (e.g. via paste) so we don't silently drop bytes.
const IMAGE_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "svg"];

#[derive(Debug, Serialize)]
pub struct AttachmentMeta {
    /// Vault-relative path, always starting with `attachments/`.
    pub path: String,
    pub name: String,
    pub size: u64,
    pub ext: String,
}

#[derive(Debug, Serialize)]
pub struct DeleteResult {
    pub deleted: bool,
    /// Notes that reference this attachment. When non-empty we refuse to
    /// delete and surface the list so the UI can warn the user.
    pub referenced_in: Vec<String>,
}

async fn vault_root(state: &State<'_, AppState>) -> Result<PathBuf, String> {
    let guard = state.vault.lock().await;
    guard
        .as_ref()
        .map(|v| v.root.clone())
        .ok_or_else(|| "No vault open".into())
}

fn ensure_attachments_dir(vault_root: &Path) -> Result<PathBuf, String> {
    let dir = vault_root.join(ATTACHMENTS_DIR);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create attachments dir: {e}"))?;
    Ok(dir)
}

/// Strip path components and reject empties / parent traversal. We never
/// trust the caller's file name verbatim because drag-and-drop / URL
/// downloads can carry arbitrary OS paths or `../` segments.
fn sanitize_filename(name: &str) -> Option<String> {
    let base = Path::new(name).file_name()?.to_string_lossy().to_string();
    let trimmed = base.trim();
    if trimmed.is_empty() || trimmed == "." || trimmed == ".." {
        return None;
    }
    Some(trimmed.to_string())
}

/// Append `-1`, `-2`, ... before the extension until the path is free.
/// Drag-and-drop typically reuses names (`screenshot.png`) so dedup is the
/// common path, not the exception.
fn dedupe_path(dir: &Path, desired: &str) -> PathBuf {
    let candidate = dir.join(desired);
    if !candidate.exists() {
        return candidate;
    }
    let p = Path::new(desired);
    let stem = p
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| desired.to_string());
    let ext = p
        .extension()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_default();
    let mut i = 1;
    loop {
        let name = if ext.is_empty() {
            format!("{stem}-{i}")
        } else {
            format!("{stem}-{i}.{ext}")
        };
        let cand = dir.join(&name);
        if !cand.exists() {
            return cand;
        }
        i += 1;
    }
}

fn timestamp_name(ext: &str) -> String {
    let stamp = Local::now().format("%Y-%m-%d_%H%M%S");
    if ext.is_empty() {
        stamp.to_string()
    } else {
        format!("{stamp}.{ext}")
    }
}

fn rel_string(vault_root: &Path, abs: &Path) -> String {
    abs.strip_prefix(vault_root)
        .unwrap_or(abs)
        .to_string_lossy()
        .replace('\\', "/")
}

/// Copy a file from any absolute path on disk into `attachments/`.
/// Returns the vault-relative path the caller should embed in the note.
#[tauri::command]
pub async fn attachment_save_file(
    source_path: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let vault = vault_root(&state).await?;
    let dir = ensure_attachments_dir(&vault)?;

    let source = PathBuf::from(&source_path);
    if !source.is_file() {
        return Err(format!("Source is not a file: {source_path}"));
    }
    let name = source
        .file_name()
        .map(|s| s.to_string_lossy().to_string())
        .and_then(|s| sanitize_filename(&s))
        .ok_or_else(|| "Invalid source filename".to_string())?;

    let dest = dedupe_path(&dir, &name);
    std::fs::copy(&source, &dest).map_err(|e| format!("Failed to copy attachment: {e}"))?;
    Ok(rel_string(&vault, &dest))
}

/// Save raw bytes (clipboard paste) into `attachments/` with a timestamp
/// filename. `ext` is the extension without the leading dot (e.g. `png`).
#[tauri::command]
pub async fn attachment_save_bytes(
    data: Vec<u8>,
    ext: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let vault = vault_root(&state).await?;
    let dir = ensure_attachments_dir(&vault)?;
    let ext = ext.trim().trim_start_matches('.').to_lowercase();
    let name = timestamp_name(&ext);
    let dest = dedupe_path(&dir, &name);
    std::fs::write(&dest, &data).map_err(|e| format!("Failed to write attachment: {e}"))?;
    Ok(rel_string(&vault, &dest))
}

/// Download a remote image into `attachments/`. The caller passes the URL
/// from `![alt](url)` and we return the new vault-relative path so the
/// editor can rewrite the link to the local file.
#[tauri::command]
pub async fn attachment_download_url(
    url: String,
    state: State<'_, AppState>,
) -> Result<String, String> {
    let vault = vault_root(&state).await?;
    let dir = ensure_attachments_dir(&vault)?;

    let parsed = url::Url::parse(&url).map_err(|e| format!("Invalid URL: {e}"))?;
    if !matches!(parsed.scheme(), "http" | "https") {
        return Err(format!("Unsupported URL scheme: {}", parsed.scheme()));
    }

    let resp = reqwest::get(&url)
        .await
        .map_err(|e| format!("Download failed: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("Download failed: HTTP {}", resp.status()));
    }
    let content_type = resp
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
        .to_string();
    let bytes = resp
        .bytes()
        .await
        .map_err(|e| format!("Download failed: {e}"))?;

    // Prefer the last path segment when it has an image-like extension —
    // it keeps the original file name visible in `attachments/`. Otherwise
    // fall back to the timestamp form + an extension derived from the
    // Content-Type so we never write a name-less blob.
    let url_name = parsed
        .path_segments()
        .and_then(|mut s| s.next_back())
        .and_then(sanitize_filename);
    let name = match url_name {
        Some(n) if has_image_ext(&n) => n,
        _ => {
            let ext = ext_from_mime(&content_type).unwrap_or("bin").to_string();
            timestamp_name(&ext)
        }
    };

    let dest = dedupe_path(&dir, &name);
    std::fs::write(&dest, &bytes).map_err(|e| format!("Failed to write attachment: {e}"))?;
    Ok(rel_string(&vault, &dest))
}

/// Flat listing of every file in `attachments/`. Used by a future
/// attachment manager; in v1 it powers a "find orphans" path the user can
/// trigger manually.
#[tauri::command]
pub async fn attachment_list(
    state: State<'_, AppState>,
) -> Result<Vec<AttachmentMeta>, String> {
    let vault = vault_root(&state).await?;
    let dir = vault.join(ATTACHMENTS_DIR);
    if !dir.is_dir() {
        return Ok(Vec::new());
    }

    let mut out = Vec::new();
    for entry in std::fs::read_dir(&dir).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let meta = entry.metadata().map_err(|e| e.to_string())?;
        let name = entry.file_name().to_string_lossy().to_string();
        let ext = path
            .extension()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        out.push(AttachmentMeta {
            path: rel_string(&vault, &path),
            name,
            size: meta.len(),
            ext,
        });
    }
    out.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(out)
}

/// Delete an attachment by relative path or bare filename. Refuses the
/// delete and returns the referencing notes when any markdown file links
/// to the attachment — the spec calls for a confirmation flow, not a
/// silent broken-link.
#[tauri::command]
pub async fn attachment_delete(
    filename: String,
    state: State<'_, AppState>,
) -> Result<DeleteResult, String> {
    let vault = vault_root(&state).await?;
    let bare = sanitize_filename(&filename).ok_or_else(|| "Invalid filename".to_string())?;
    let abs = vault.join(ATTACHMENTS_DIR).join(&bare);

    if !abs.is_file() {
        return Err(format!("Attachment not found: {bare}"));
    }

    let references = find_references(&vault, &bare).map_err(|e| e.to_string())?;
    if !references.is_empty() {
        return Ok(DeleteResult {
            deleted: false,
            referenced_in: references,
        });
    }
    std::fs::remove_file(&abs).map_err(|e| format!("Failed to delete attachment: {e}"))?;
    Ok(DeleteResult {
        deleted: true,
        referenced_in: Vec::new(),
    })
}

fn has_image_ext(name: &str) -> bool {
    let ext = Path::new(name)
        .extension()
        .map(|s| s.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    IMAGE_EXTS.iter().any(|e| *e == ext)
}

fn ext_from_mime(mime: &str) -> Option<&'static str> {
    let base = mime.split(';').next().unwrap_or("").trim().to_lowercase();
    match base.as_str() {
        "image/png" => Some("png"),
        "image/jpeg" => Some("jpg"),
        "image/gif" => Some("gif"),
        "image/webp" => Some("webp"),
        "image/svg+xml" => Some("svg"),
        _ => None,
    }
}

/// Walk every `.md` file in the vault and collect those that mention the
/// attachment filename. Plain substring search is good enough — false
/// positives are harmless (the worst case is "we asked if you really
/// want to delete"). We skip `.md.age` because we don't have the key
/// here and don't want to force unlock for a delete confirmation.
fn find_references(vault_root: &Path, filename: &str) -> std::io::Result<Vec<String>> {
    let needle = filename.to_string();
    let mut hits = Vec::new();
    let walker = walkdir::WalkDir::new(vault_root).into_iter().filter_entry(|e| {
        let n = e.file_name().to_string_lossy();
        !n.starts_with('.')
    });
    for entry in walker.filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let ext_ok = path.extension().map(|e| e == "md").unwrap_or(false);
        if !ext_ok {
            continue;
        }
        if let Ok(text) = std::fs::read_to_string(path) {
            if text.contains(&needle) {
                let rel = path
                    .strip_prefix(vault_root)
                    .unwrap_or(path)
                    .to_string_lossy()
                    .replace('\\', "/");
                hits.push(rel);
            }
        }
    }
    Ok(hits)
}
