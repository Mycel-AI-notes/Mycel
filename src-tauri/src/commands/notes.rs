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

    crate::core::ai::filing_log::append(
        &vault_root,
        &serde_json::json!({
            "ts": chrono::Utc::now().to_rfc3339(),
            "event": "outcome",
            "action": "merge",
            "source": source,
            "target": target,
            "deleted_source": delete_source,
        }),
    );

    if let Ok(ai) = crate::commands::ai::ensure_ai_state(&state).await {
        refresh_index_after_merge(&ai, &vault_root, &source, &target, delete_source).await;
    }

    Ok(timestamp)
}

#[derive(Debug, Serialize)]
pub struct QuickSuggestions {
    /// Human title for the note, only while it still wears its auto
    /// timestamp name (`HH-MM-SS.md`). `None` once the user renamed it.
    pub title: Option<String>,
    pub targets: Vec<crate::core::ai::quick_suggest::TargetHit>,
    /// Vault-relative path for a brand-new note, proposed by the LLM when
    /// nothing in the vault covers the topic ("start a project with this").
    pub create_path: Option<String>,
    /// One short LLM sentence explaining the choice, in the note's language.
    pub reason: Option<String>,
    /// False when AI is off or no key is saved — the bar can then only
    /// offer the rename and hints at enabling AI for filing targets.
    pub ai_available: bool,
}

/// Similarity floor for the candidate list handed to the LLM. Deliberately
/// lower than the user-facing threshold: the model reads the candidates'
/// content and can reject them; without an LLM verdict the user threshold
/// still gates what the bar shows.
const LLM_CANDIDATE_FLOOR: f32 = 0.35;

/// Suggestions for the in-editor filing bar, computed right after a quick
/// note is saved: a title derived from the note, the closest merge targets,
/// and — when a chat model is reachable — an LLM verdict on where the note
/// belongs, possibly "start a new note". The vault index is refreshed first
/// (incremental: unchanged notes are hash-skipped) so both the fresh quick
/// note and never-indexed targets can match at all.
#[tauri::command]
pub async fn quick_note_suggest(
    path: String,
    state: State<'_, AppState>,
) -> Result<QuickSuggestions, String> {
    use crate::core::ai::quick_suggest;
    use crate::core::quick_filing as qf;

    let vault_root = {
        let guard = state.vault.lock().await;
        guard
            .as_ref()
            .map(|v| v.root.clone())
            .ok_or("No vault open")?
    };
    if !is_safe_rel_path(&path) || !qf::is_quick_path(&path) || !path.ends_with(".md") {
        return Err("Not a quick note".into());
    }

    let raw = std::fs::read_to_string(vault_root.join(&path)).map_err(|e| e.to_string())?;
    let body = qf::note_body(&raw, &path);
    let still_auto_named = qf::capture_timestamp(&path).is_some();
    let mut out = QuickSuggestions {
        title: None,
        targets: vec![],
        create_path: None,
        reason: None,
        ai_available: false,
    };
    if body.is_empty() {
        out.ai_available = true;
        return Ok(out);
    }
    if still_auto_named {
        out.title = qf::suggest_title(&body);
    }

    let Ok(ai) = crate::commands::ai::ensure_ai_state(&state).await else {
        return Ok(out);
    };
    let cfg = ai.config.lock().await.clone();
    let key = crate::core::ai::keyring::get_key(&vault_root).ok().flatten();
    let (true, Some(key)) = (cfg.enabled, key) else {
        return Ok(out);
    };
    out.ai_available = true;

    // Freshen the whole index, not just this note: on a vault that was
    // never indexed there is nothing to match against otherwise.
    {
        let _guard = ai.indexing.lock().await;
        let embedder =
            crate::core::ai::embedder::OpenRouterEmbedder::new(key.clone(), cfg.embedding_model.clone());
        if let Err(e) = crate::core::ai::indexer::bulk_reindex(
            &ai.store,
            &embedder,
            &vault_root,
            cfg.daily_budget_usd,
            &cfg.embedding_model,
            |_p| {},
        )
        .await
        {
            eprintln!("quick_note_suggest: reindex failed: {e:#}");
        }
    }

    let min_similarity = {
        let s = ai.insights.settings.lock().await;
        (s.quick_filing_min_similarity.min(100) as f32) / 100.0
    };
    let wide =
        quick_suggest::rank_targets(&ai.store, &path, &body, LLM_CANDIDATE_FLOOR, 6)
            .map_err(|e| e.to_string())?;

    let advice = llm_filing_advice(&ai, &vault_root, &key, &cfg, &body, &wide).await;
    let advice_for_log = advice.clone();

    match advice {
        Some(advice) => {
            if still_auto_named {
                if let Some(t) = advice
                    .title
                    .as_deref()
                    .map(qf::sanitize_for_filename)
                    .filter(|t| !t.is_empty())
                {
                    out.title = Some(t);
                }
            }
            out.reason = advice.reason.map(|r| r.chars().take(200).collect());

            // The model's pick leads, validated against the candidate list
            // so a hallucinated path can never reach the UI.
            if let Some(tp) = advice.target.as_deref() {
                if let Some(hit) = wide.iter().find(|h| h.note_path == tp) {
                    out.targets.push(hit.clone());
                }
            }
            for h in &wide {
                if out.targets.len() >= 3 {
                    break;
                }
                if h.similarity < min_similarity
                    || out.targets.iter().any(|t| t.note_path == h.note_path)
                {
                    continue;
                }
                out.targets.push(h.clone());
            }

            // "Start a new note" only when nothing existing was accepted.
            if out.targets.is_empty() {
                if let Some((folder, name)) = advice.new_note {
                    let name = qf::sanitize_for_filename(&name);
                    if !name.is_empty() {
                        let rel = if folder.is_empty() {
                            format!("{name}.md")
                        } else {
                            format!("{folder}/{name}.md")
                        };
                        let folder_ok =
                            folder.is_empty() || vault_root.join(&folder).is_dir();
                        if is_safe_rel_path(&rel)
                            && !qf::is_quick_path(&rel)
                            && folder_ok
                            && !vault_root.join(&rel).exists()
                        {
                            out.create_path = Some(rel);
                        }
                    }
                }
            }
        }
        // No LLM verdict (offline, over budget, unparseable): plain
        // embedding ranking under the user's threshold.
        None => {
            out.targets = wide
                .iter()
                .filter(|h| h.similarity >= min_similarity)
                .take(3)
                .cloned()
                .collect();
        }
    }

    // Trace for later tuning: what we saw, what the model said, what the
    // bar showed. Outcomes (merge/rename/create/dismiss) land in the same
    // file as separate records.
    crate::core::ai::filing_log::append(
        &vault_root,
        &serde_json::json!({
            "ts": chrono::Utc::now().to_rfc3339(),
            "event": "suggest",
            "note": path,
            "body": body.chars().take(2000).collect::<String>(),
            "candidates": wide
                .iter()
                .map(|h| serde_json::json!({
                    "path": h.note_path,
                    "similarity": h.similarity,
                }))
                .collect::<Vec<_>>(),
            "llm_used": advice_for_log.is_some(),
            "llm": advice_for_log,
            "shown": {
                "title": out.title,
                "targets": out.targets.iter().map(|t| t.note_path.clone()).collect::<Vec<_>>(),
                "create_path": out.create_path,
            },
        }),
    );

    Ok(out)
}

/// Outcome records for the quick-filing trace: the frontend reports what
/// the user did with a suggestion (rename, create, dismiss). Merges are
/// logged by `quick_note_merge` itself.
#[tauri::command]
pub async fn quick_filing_log_outcome(
    action: String,
    source: String,
    target: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let vault_root = {
        let guard = state.vault.lock().await;
        guard
            .as_ref()
            .map(|v| v.root.clone())
            .ok_or("No vault open")?
    };
    crate::core::ai::filing_log::outcome(&vault_root, &action, &source, target.as_deref());
    Ok(())
}

/// Ask the chat model where the note belongs. `None` on any failure —
/// missing budget, network error, unparseable reply — the caller falls
/// back to pure-embedding suggestions.
async fn llm_filing_advice(
    ai: &std::sync::Arc<crate::core::ai::AiState>,
    vault_root: &std::path::Path,
    key: &str,
    cfg: &crate::core::ai::config::AiConfig,
    body: &str,
    wide: &[crate::core::ai::quick_suggest::TargetHit],
) -> Option<crate::core::ai::quick_suggest::LlmAdvice> {
    use crate::core::ai::{budget, openrouter::OpenRouterClient, quick_suggest};
    use crate::core::quick_filing as qf;

    let candidates: Vec<quick_suggest::CandidateContext> = wide
        .iter()
        .map(|t| {
            let snippet = std::fs::read_to_string(vault_root.join(&t.note_path))
                .map(|raw| {
                    qf::strip_frontmatter(&raw)
                        .trim()
                        .chars()
                        .take(240)
                        .collect::<String>()
                })
                .unwrap_or_default();
            quick_suggest::CandidateContext {
                note_path: t.note_path.clone(),
                similarity: t.similarity,
                snippet,
            }
        })
        .collect();
    let folders = vault_folders(vault_root);
    let user = quick_suggest::filing_user_prompt(body, &candidates, &folders);

    let est = quick_suggest::est_chat_cost_usd(
        quick_suggest::FILING_SYSTEM_PROMPT.len() + user.len(),
    );
    if let Err(e) = budget::check(&ai.store, cfg.daily_budget_usd, &cfg.chat_model, est) {
        eprintln!("quick_note_suggest: chat step skipped: {e:#}");
        return None;
    }

    let client = OpenRouterClient::new();
    match client
        .chat(key, &cfg.chat_model, quick_suggest::FILING_SYSTEM_PROMPT, &user)
        .await
    {
        Ok(reply) => {
            let tokens_in = reply.usage.prompt_tokens;
            let tokens_out = reply.usage.total_tokens.saturating_sub(tokens_in);
            let cost = quick_suggest::chat_cost_usd(tokens_in, tokens_out);
            if let Err(e) =
                budget::record(&ai.store, &cfg.chat_model, tokens_in, tokens_out, cost)
            {
                eprintln!("quick_note_suggest: usage record failed: {e:#}");
            }
            quick_suggest::parse_advice(&reply.content)
        }
        Err(e) => {
            eprintln!("quick_note_suggest: chat failed: {e:#}");
            None
        }
    }
}

/// Vault folders (depth ≤ 2) the LLM may file a brand-new note into.
/// Hidden directories and the quick-capture folder are excluded.
fn vault_folders(vault_root: &std::path::Path) -> Vec<String> {
    let mut out = Vec::new();
    for entry in walkdir::WalkDir::new(vault_root)
        .min_depth(1)
        .max_depth(2)
        .into_iter()
        .filter_entry(|e| !e.file_name().to_string_lossy().starts_with('.'))
        .filter_map(|e| e.ok())
        .filter(|e| e.file_type().is_dir())
    {
        let Ok(rel_os) = entry.path().strip_prefix(vault_root) else {
            continue;
        };
        let rel = rel_os
            .components()
            .filter_map(|c| c.as_os_str().to_str())
            .collect::<Vec<_>>()
            .join("/");
        if rel == QUICK_NOTES_DIR || crate::core::quick_filing::is_quick_path(&rel) {
            continue;
        }
        out.push(rel);
        if out.len() >= 30 {
            break;
        }
    }
    out.sort();
    out
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
