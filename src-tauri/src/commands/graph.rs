use crate::core::parser::parse_note;
use crate::AppState;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;
use tauri::State;
use walkdir::WalkDir;

#[derive(Debug, Serialize, Deserialize)]
pub struct GraphNote {
    pub path: String,
    pub title: String,
    pub folder: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GraphFolder {
    /// Vault-relative path (empty string = vault root).
    pub path: String,
    pub name: String,
    /// Vault-relative parent folder; `None` for the root.
    pub parent: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GraphDomain {
    pub domain: String,
    pub count: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WikiEdge {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ExternalEdge {
    pub from: String,
    pub domain: String,
    pub count: u32,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GraphData {
    pub notes: Vec<GraphNote>,
    pub folders: Vec<GraphFolder>,
    pub domains: Vec<GraphDomain>,
    pub wiki_edges: Vec<WikiEdge>,
    pub external_edges: Vec<ExternalEdge>,
}

fn url_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r#"https?://([^/\s<>")\]]+)"#).unwrap())
}

fn parent_folder(rel: &str) -> String {
    std::path::Path::new(rel)
        .parent()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_default()
}

fn normalize_target(target: &str) -> String {
    // Drop heading anchors, strip optional .md, lowercase the stem.
    let head = target.split('#').next().unwrap_or(target).trim();
    let stem = std::path::Path::new(head)
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| head.to_string());
    stem.to_lowercase()
}

#[tauri::command]
pub async fn graph_data(state: State<'_, AppState>) -> Result<GraphData, String> {
    let vault_root = {
        let guard = state.vault.lock().await;
        guard
            .as_ref()
            .map(|v| v.root.clone())
            .ok_or("No vault open")?
    };

    // Pass 1: enumerate notes; index by lowercased stem so wikilinks can
    // resolve `[[Note]]` regardless of folder.
    struct Loaded {
        path: String,
        title: String,
        folder: String,
        content: String,
    }
    let mut loaded: Vec<Loaded> = Vec::new();
    // Multiple lookup tables so wikilinks resolve regardless of whether the
    // author wrote `[[Note]]`, `[[folder/Note]]`, `[[Note.md]]` or
    // `[[Long Title From Frontmatter]]`. First-writer wins on collisions.
    let mut stem_to_path: HashMap<String, String> = HashMap::new();
    let mut title_to_path: HashMap<String, String> = HashMap::new();
    let mut rel_to_path: HashMap<String, String> = HashMap::new();

    for entry in WalkDir::new(&vault_root).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if !path.extension().map(|e| e == "md").unwrap_or(false) {
            continue;
        }
        let rel = path
            .strip_prefix(&vault_root)
            .unwrap_or(path)
            .to_string_lossy()
            .to_string();
        if rel.contains("/.") || rel.starts_with('.') {
            continue;
        }
        let content = match std::fs::read_to_string(path) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let parsed_meta = parse_note(&content);
        let stem = path
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();
        let title = parsed_meta.meta.title.unwrap_or_else(|| stem.clone());
        let folder = parent_folder(&rel);
        stem_to_path.entry(stem.to_lowercase()).or_insert_with(|| rel.clone());
        title_to_path
            .entry(title.to_lowercase())
            .or_insert_with(|| rel.clone());
        rel_to_path.insert(rel.to_lowercase(), rel.clone());
        // Also index the relative path without `.md`, so `[[folder/Note]]`
        // resolves even when the file is `folder/Note.md`.
        let rel_no_ext = rel
            .strip_suffix(".md")
            .map(|s| s.to_string())
            .unwrap_or_else(|| rel.clone());
        rel_to_path.entry(rel_no_ext.to_lowercase()).or_insert_with(|| rel.clone());
        loaded.push(Loaded { path: rel, title, folder, content });
    }

    // Pass 2: build edges + collect folder paths + domain counts.
    let mut folder_set: HashSet<String> = HashSet::new();
    let mut wiki_edges: Vec<WikiEdge> = Vec::new();
    let mut domain_counts: HashMap<String, u32> = HashMap::new();
    let mut external_counts: HashMap<(String, String), u32> = HashMap::new();
    let mut notes_out: Vec<GraphNote> = Vec::with_capacity(loaded.len());

    for note in &loaded {
        folder_set.insert(note.folder.clone());

        let parsed = parse_note(&note.content);
        let mut seen_targets: HashSet<String> = HashSet::new();
        for wl in &parsed.wikilinks {
            if wl.is_embed {
                continue;
            }
            // Try several resolution strategies, in order of specificity:
            //   1. Full relative path (with or without `.md`).
            //   2. Bare filename stem.
            //   3. Title (from frontmatter or filename stem).
            let raw = wl.target.split('#').next().unwrap_or(&wl.target).trim();
            let raw_lower = raw.to_lowercase();
            let stem_key = normalize_target(&wl.target);

            let resolved = rel_to_path
                .get(&raw_lower)
                .or_else(|| stem_to_path.get(&stem_key))
                .or_else(|| title_to_path.get(&raw_lower));

            let Some(target_path) = resolved else {
                continue;
            };
            if *target_path == note.path {
                continue;
            }
            // Dedupe by `target_path` so multiple `[[X]]` mentions collapse
            // into a single edge per source.
            if !seen_targets.insert(target_path.clone()) {
                continue;
            }
            wiki_edges.push(WikiEdge {
                from: note.path.clone(),
                to: target_path.clone(),
            });
        }

        // External URLs — count per-(note, domain).
        for cap in url_re().captures_iter(&note.content) {
            let raw_host = &cap[1];
            let host = raw_host.split(':').next().unwrap_or(raw_host).to_lowercase();
            let host = host.trim_start_matches("www.").to_string();
            if host.is_empty() {
                continue;
            }
            *domain_counts.entry(host.clone()).or_insert(0) += 1;
            *external_counts
                .entry((note.path.clone(), host))
                .or_insert(0) += 1;
        }

        notes_out.push(GraphNote {
            path: note.path.clone(),
            title: note.title.clone(),
            folder: note.folder.clone(),
        });
    }

    // Expand folder hierarchy: every ancestor of every note's folder is itself
    // a folder node so the containment chain is complete.
    let mut expanded: HashSet<String> = HashSet::new();
    for f in folder_set.iter() {
        let mut cur: Option<&Path> = Some(std::path::Path::new(f));
        while let Some(p) = cur {
            let s = p.to_string_lossy().to_string();
            expanded.insert(s);
            cur = p.parent().filter(|pp| !pp.as_os_str().is_empty());
        }
    }
    expanded.insert(String::new()); // root sentinel

    let mut folders_out: Vec<GraphFolder> = expanded
        .into_iter()
        .map(|p| {
            let name = if p.is_empty() {
                "/".to_string()
            } else {
                std::path::Path::new(&p)
                    .file_name()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| p.clone())
            };
            let parent = if p.is_empty() {
                None
            } else {
                Some(parent_folder(&p))
            };
            GraphFolder { path: p, name, parent }
        })
        .collect();
    folders_out.sort_by(|a, b| a.path.cmp(&b.path));

    let mut domains_out: Vec<GraphDomain> = domain_counts
        .into_iter()
        .map(|(domain, count)| GraphDomain { domain, count })
        .collect();
    domains_out.sort_by(|a, b| b.count.cmp(&a.count).then(a.domain.cmp(&b.domain)));

    let external_edges: Vec<ExternalEdge> = external_counts
        .into_iter()
        .map(|((from, domain), count)| ExternalEdge { from, domain, count })
        .collect();

    Ok(GraphData {
        notes: notes_out,
        folders: folders_out,
        domains: domains_out,
        wiki_edges,
        external_edges,
    })
}

// Re-import Path here so the `use` above stays clean of conditional cfg.
use std::path::Path;
