use std::path::Path;

use crate::core::links::{link_key, note_stem};
use crate::core::parser::parse_note;
use crate::core::vault::note_paths;
use crate::AppState;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};
use std::sync::OnceLock;
use tauri::State;

#[derive(Debug, Clone, Serialize, Deserialize)]
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct GraphTag {
    pub tag: String,
    pub count: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct TagEdge {
    pub from: String,
    pub tag: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GraphData {
    pub notes: Vec<GraphNote>,
    pub folders: Vec<GraphFolder>,
    pub domains: Vec<GraphDomain>,
    pub tags: Vec<GraphTag>,
    pub wiki_edges: Vec<WikiEdge>,
    pub external_edges: Vec<ExternalEdge>,
    pub tag_edges: Vec<TagEdge>,
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
    Ok(build_graph(&vault_root))
}

/// Build the graph for a vault: note and folder nodes, wikilink edges, and
/// external-domain and tag aggregates.
///
/// Split out of the command so it can be tested — the resolution order alone
/// (full path, then bare stem, then frontmatter title) is four behaviours that
/// had no coverage at all.
pub fn build_graph(vault_root: &Path) -> GraphData {
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
    // Frontmatter `aliases`, consulted last: an alias never shadows a note
    // that is actually called that.
    let mut alias_to_path: HashMap<String, String> = HashMap::new();

    for rel in note_paths(vault_root) {
        // The graph reads note bodies for links and tags, which an encrypted
        // note does not give up without the vault unlocked. Its node would
        // then flicker in and out of the graph depending on lock state, so
        // leave `.md.age` out of the graph entirely for now.
        if rel.ends_with(".md.age") {
            continue;
        }
        let content = match std::fs::read_to_string(vault_root.join(&rel)) {
            Ok(c) => c,
            Err(_) => continue,
        };
        let parsed_meta = parse_note(&content);
        let stem = note_stem(&rel).to_string();
        let title = parsed_meta.meta.title.unwrap_or_else(|| stem.clone());
        let folder = parent_folder(&rel);
        stem_to_path
            .entry(stem.to_lowercase())
            .or_insert_with(|| rel.clone());
        title_to_path
            .entry(title.to_lowercase())
            .or_insert_with(|| rel.clone());
        rel_to_path.insert(rel.to_lowercase(), rel.clone());
        for alias in &parsed_meta.meta.aliases {
            alias_to_path
                .entry(alias.to_lowercase())
                .or_insert_with(|| rel.clone());
        }
        // Also index the relative path without `.md`, so `[[folder/Note]]`
        // resolves even when the file is `folder/Note.md`.
        let rel_no_ext = rel
            .strip_suffix(".md")
            .map(|s| s.to_string())
            .unwrap_or_else(|| rel.clone());
        rel_to_path
            .entry(rel_no_ext.to_lowercase())
            .or_insert_with(|| rel.clone());
        loaded.push(Loaded {
            path: rel,
            title,
            folder,
            content,
        });
    }

    // Pass 2: build edges + collect folder paths + domain counts.
    let mut folder_set: HashSet<String> = HashSet::new();
    let mut wiki_edges: Vec<WikiEdge> = Vec::new();
    let mut domain_counts: HashMap<String, u32> = HashMap::new();
    let mut external_counts: HashMap<(String, String), u32> = HashMap::new();
    let mut tag_counts: HashMap<String, u32> = HashMap::new();
    let mut tag_edges: Vec<TagEdge> = Vec::new();
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
            //   4. Frontmatter alias.
            let raw = wl.target.split('#').next().unwrap_or(&wl.target).trim();
            let raw_lower = raw.to_lowercase();
            let stem_key = normalize_target(&wl.target);

            let resolved = rel_to_path
                .get(&raw_lower)
                .or_else(|| stem_to_path.get(&stem_key))
                .or_else(|| title_to_path.get(&raw_lower))
                .or_else(|| alias_to_path.get(&link_key(&wl.target)));

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

        // Tags — union of frontmatter and body, deduped per note.
        let mut note_tags: HashSet<String> = HashSet::new();
        for t in parsed.meta.tags.iter().chain(parsed.tags.iter()) {
            let normalized = t.trim().trim_start_matches('#').to_lowercase();
            if normalized.is_empty() {
                continue;
            }
            note_tags.insert(normalized);
        }
        for tag in &note_tags {
            *tag_counts.entry(tag.clone()).or_insert(0) += 1;
            tag_edges.push(TagEdge {
                from: note.path.clone(),
                tag: tag.clone(),
            });
        }

        // External URLs — count per-(note, domain).
        for cap in url_re().captures_iter(&note.content) {
            let raw_host = &cap[1];
            let host = raw_host
                .split(':')
                .next()
                .unwrap_or(raw_host)
                .to_lowercase();
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
            GraphFolder {
                path: p,
                name,
                parent,
            }
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
        .map(|((from, domain), count)| ExternalEdge {
            from,
            domain,
            count,
        })
        .collect();

    let mut tags_out: Vec<GraphTag> = tag_counts
        .into_iter()
        .map(|(tag, count)| GraphTag { tag, count })
        .collect();
    tags_out.sort_by(|a, b| b.count.cmp(&a.count).then(a.tag.cmp(&b.tag)));

    GraphData {
        notes: notes_out,
        folders: folders_out,
        domains: domains_out,
        tags: tags_out,
        wiki_edges,
        external_edges,
        tag_edges,
    }
}

/// Deepest neighbourhood the local graph offers. Past three hops a
/// well-linked vault is most of the global graph again, which the global
/// view already shows better.
pub const MAX_LOCAL_DEPTH: u32 = 3;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LocalNote {
    pub path: String,
    pub title: String,
    pub folder: String,
    /// Hops from the centre over wikilinks, either direction; 0 = centre.
    pub depth: u32,
}

/// The neighbourhood of one note: a slice of [`GraphData`], not a separate
/// model, so a link counts here exactly when the global graph draws it.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct LocalGraph {
    pub center: String,
    /// Sorted by depth, then title. Empty when the centre is not in the
    /// graph at all (an encrypted note, or a path that no longer exists).
    pub notes: Vec<LocalNote>,
    /// Every wikilink between two notes in the neighbourhood — including the
    /// ones between two neighbours, which is what makes clusters visible.
    pub wiki_edges: Vec<WikiEdge>,
    /// Tags carried by notes in the neighbourhood, counted within it. Empty
    /// unless asked for: tags are leaves, never a path to more notes.
    pub tags: Vec<GraphTag>,
    pub tag_edges: Vec<TagEdge>,
}

/// Breadth-first neighbourhood of `center` up to `depth` hops (clamped to
/// 1..=[`MAX_LOCAL_DEPTH`]) over the global graph's wikilink edges, followed
/// in both directions: a backlink is as much a neighbour as an outgoing link.
pub fn local_subgraph(g: &GraphData, center: &str, depth: u32, include_tags: bool) -> LocalGraph {
    let depth = depth.clamp(1, MAX_LOCAL_DEPTH);
    let mut out = LocalGraph {
        center: center.to_string(),
        notes: Vec::new(),
        wiki_edges: Vec::new(),
        tags: Vec::new(),
        tag_edges: Vec::new(),
    };
    let by_path: HashMap<&str, &GraphNote> = g.notes.iter().map(|n| (n.path.as_str(), n)).collect();
    if !by_path.contains_key(center) {
        return out;
    }

    let mut adjacent: HashMap<&str, Vec<&str>> = HashMap::new();
    for e in &g.wiki_edges {
        adjacent.entry(&e.from).or_default().push(&e.to);
        adjacent.entry(&e.to).or_default().push(&e.from);
    }

    let mut dist: HashMap<&str, u32> = HashMap::from([(center, 0)]);
    let mut queue: VecDeque<&str> = VecDeque::from([center]);
    while let Some(cur) = queue.pop_front() {
        let d = dist[cur];
        if d == depth {
            continue;
        }
        for &next in adjacent.get(cur).map(Vec::as_slice).unwrap_or(&[]) {
            if !dist.contains_key(next) && by_path.contains_key(next) {
                dist.insert(next, d + 1);
                queue.push_back(next);
            }
        }
    }

    out.notes = dist
        .iter()
        .map(|(&path, &depth)| {
            let n = by_path[path];
            LocalNote {
                path: n.path.clone(),
                title: n.title.clone(),
                folder: n.folder.clone(),
                depth,
            }
        })
        .collect();
    out.notes.sort_by(|a, b| {
        a.depth
            .cmp(&b.depth)
            .then_with(|| a.title.to_lowercase().cmp(&b.title.to_lowercase()))
            .then_with(|| a.path.cmp(&b.path))
    });

    out.wiki_edges = g
        .wiki_edges
        .iter()
        .filter(|e| dist.contains_key(e.from.as_str()) && dist.contains_key(e.to.as_str()))
        .cloned()
        .collect();

    if include_tags {
        let mut counts: HashMap<&str, u32> = HashMap::new();
        for e in &g.tag_edges {
            if dist.contains_key(e.from.as_str()) {
                *counts.entry(&e.tag).or_insert(0) += 1;
                out.tag_edges.push(e.clone());
            }
        }
        out.tags = counts
            .into_iter()
            .map(|(tag, count)| GraphTag {
                tag: tag.to_string(),
                count,
            })
            .collect();
        out.tags
            .sort_by(|a, b| b.count.cmp(&a.count).then(a.tag.cmp(&b.tag)));
    }
    out
}

/// The neighbourhood of `path`, for the local graph. Builds the full graph
/// first so resolution (paths, stems, titles, aliases) is exactly the global
/// graph's — two views that disagree about what links where would be worse
/// than one that is a little slower on a huge vault.
#[tauri::command]
pub async fn graph_local(
    path: String,
    depth: Option<u32>,
    include_tags: Option<bool>,
    state: State<'_, AppState>,
) -> Result<LocalGraph, String> {
    let vault_root = {
        let guard = state.vault.lock().await;
        guard
            .as_ref()
            .map(|v| v.root.clone())
            .ok_or("No vault open")?
    };
    tokio::task::spawn_blocking(move || {
        let g = build_graph(&vault_root);
        local_subgraph(&g, &path, depth.unwrap_or(1), include_tags.unwrap_or(false))
    })
    .await
    .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write(root: &Path, rel: &str, body: &str) {
        let p = root.join(rel);
        std::fs::create_dir_all(p.parent().unwrap()).unwrap();
        std::fs::write(p, body).unwrap();
    }

    fn edge_exists(g: &GraphData, from: &str, to: &str) -> bool {
        g.wiki_edges.iter().any(|e| e.from == from && e.to == to)
    }

    #[test]
    fn notes_become_nodes_with_titles_and_folders() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "projects/garden.md", "---\ntitle: The Garden\n---\n");

        let g = build_graph(root);

        assert_eq!(g.notes.len(), 1);
        assert_eq!(g.notes[0].path, "projects/garden.md");
        assert_eq!(g.notes[0].title, "The Garden");
        assert_eq!(g.notes[0].folder, "projects");
    }

    #[test]
    fn a_title_only_frontmatter_still_names_the_node() {
        // Guards the `NoteMeta` serde-default fix from the graph's side: this
        // showed "garden" before it.
        let dir = TempDir::new().unwrap();
        write(dir.path(), "garden.md", "---\ntitle: The Garden\n---\n");

        assert_eq!(build_graph(dir.path()).notes[0].title, "The Garden");
    }

    #[test]
    fn a_bare_wikilink_resolves_across_folders() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "a/source.md", "see [[target]]");
        write(root, "b/target.md", "# Target");

        assert!(edge_exists(
            &build_graph(root),
            "a/source.md",
            "b/target.md"
        ));
    }

    #[test]
    fn a_path_qualified_wikilink_resolves() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "source.md", "see [[b/target]]");
        write(root, "b/target.md", "x");

        assert!(edge_exists(&build_graph(root), "source.md", "b/target.md"));
    }

    #[test]
    fn a_wikilink_by_frontmatter_title_resolves() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "source.md", "see [[The Long Title]]");
        write(root, "t.md", "---\ntitle: The Long Title\n---\n");

        assert!(edge_exists(&build_graph(root), "source.md", "t.md"));
    }

    #[test]
    fn a_heading_anchor_does_not_break_resolution() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "source.md", "see [[target#Section]]");
        write(root, "target.md", "x");

        assert!(edge_exists(&build_graph(root), "source.md", "target.md"));
    }

    #[test]
    fn repeated_mentions_collapse_into_one_edge() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(
            root,
            "source.md",
            "[[target]] and [[target]] and [[target|alias]]",
        );
        write(root, "target.md", "x");

        let g = build_graph(root);
        assert_eq!(g.wiki_edges.len(), 1);
    }

    #[test]
    fn a_link_resolves_through_a_frontmatter_alias() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "source.md", "see [[ML]]");
        write(root, "Machine Learning.md", "---\naliases: [ML]\n---\nx");

        assert!(edge_exists(
            &build_graph(root),
            "source.md",
            "Machine Learning.md"
        ));
    }

    #[test]
    fn a_real_note_name_outranks_an_alias() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "source.md", "see [[ML]]");
        write(root, "ML.md", "x");
        write(root, "Machine Learning.md", "---\naliases: [ML]\n---\nx");

        let g = build_graph(root);
        assert!(edge_exists(&g, "source.md", "ML.md"));
        assert!(!edge_exists(&g, "source.md", "Machine Learning.md"));
    }

    #[test]
    fn embeds_do_not_create_edges() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "source.md", "![[target]]");
        write(root, "target.md", "x");

        assert!(build_graph(root).wiki_edges.is_empty());
    }

    #[test]
    fn a_self_link_creates_no_edge() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "me.md", "I link to [[me]]");

        assert!(build_graph(root).wiki_edges.is_empty());
    }

    #[test]
    fn an_unresolved_link_creates_no_edge() {
        let dir = TempDir::new().unwrap();
        write(dir.path(), "source.md", "[[nowhere]]");

        assert!(build_graph(dir.path()).wiki_edges.is_empty());
    }

    #[test]
    fn encrypted_notes_stay_out_of_the_graph() {
        // Their bodies need the vault unlocked, so including them would make
        // nodes appear and vanish with the lock state.
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "plain.md", "x");
        write(root, "secret.md.age", "ciphertext");

        let g = build_graph(root);
        assert_eq!(g.notes.len(), 1);
        assert_eq!(g.notes[0].path, "plain.md");
    }

    #[test]
    fn dot_directories_are_not_scanned() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "note.md", "x");
        write(root, ".git/objects/x.md", "x");
        write(root, ".mycel/trash/2026/old.md", "x");

        assert_eq!(build_graph(root).notes.len(), 1);
    }

    #[test]
    fn folders_are_collected_including_the_root() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "top.md", "x");
        write(root, "a/one.md", "x");
        write(root, "a/b/two.md", "x");

        let g = build_graph(root);
        let paths: Vec<&str> = g.folders.iter().map(|f| f.path.as_str()).collect();

        assert!(paths.contains(&""), "the vault root is a folder node");
        assert!(paths.contains(&"a"));
        assert!(paths.contains(&"a/b"));
    }

    #[test]
    fn external_urls_are_aggregated_by_domain() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(
            root,
            "a.md",
            "see https://example.com/one and https://example.com/two",
        );
        write(root, "b.md", "see https://other.org/page");

        let g = build_graph(root);

        let example = g
            .domains
            .iter()
            .find(|d| d.domain == "example.com")
            .expect("example.com should be a domain node");
        assert_eq!(example.count, 2);
        assert!(g.domains.iter().any(|d| d.domain == "other.org"));
    }

    #[test]
    fn tags_are_counted_and_linked_to_their_notes() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "a.md", "about #ml");
        write(root, "b.md", "also about #ml and #gardening");

        let g = build_graph(root);

        let ml = g.tags.iter().find(|t| t.tag == "ml").unwrap();
        assert_eq!(ml.count, 2);
        assert!(g
            .tag_edges
            .iter()
            .any(|e| e.from == "a.md" && e.tag == "ml"));
        assert!(g.tags.iter().any(|t| t.tag == "gardening"));
    }

    #[test]
    fn an_empty_vault_produces_an_empty_graph() {
        let dir = TempDir::new().unwrap();
        let g = build_graph(dir.path());
        assert!(g.notes.is_empty());
        assert!(g.wiki_edges.is_empty());
        assert!(g.tags.is_empty());
    }

    // ---- local graph --------------------------------------------------------

    fn local_paths(l: &LocalGraph) -> Vec<(String, u32)> {
        l.notes.iter().map(|n| (n.path.clone(), n.depth)).collect()
    }

    /// a → b → c → d → e, plus x → a (a backlink into the centre).
    fn chain() -> TempDir {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "a.md", "[[b]] #ideas");
        write(root, "b.md", "[[c]] #ideas #work");
        write(root, "c.md", "[[d]]");
        write(root, "d.md", "[[e]]");
        write(root, "e.md", "end");
        write(root, "x.md", "points at [[a]]");
        write(root, "lonely.md", "nothing");
        dir
    }

    #[test]
    fn depth_one_follows_links_in_both_directions() {
        let dir = chain();
        let g = build_graph(dir.path());
        let l = local_subgraph(&g, "a.md", 1, false);
        assert_eq!(
            local_paths(&l),
            vec![("a.md".into(), 0), ("b.md".into(), 1), ("x.md".into(), 1)]
        );
        assert_eq!(l.wiki_edges.len(), 2);
        assert!(l.tags.is_empty() && l.tag_edges.is_empty());
    }

    #[test]
    fn deeper_levels_reach_further_and_depth_is_clamped() {
        let dir = chain();
        let g = build_graph(dir.path());
        let paths = |d| {
            let mut p: Vec<String> = local_subgraph(&g, "a.md", d, false)
                .notes
                .into_iter()
                .map(|n| n.path)
                .collect();
            p.sort();
            p
        };
        assert_eq!(paths(2), vec!["a.md", "b.md", "c.md", "x.md"]);
        assert_eq!(paths(3), vec!["a.md", "b.md", "c.md", "d.md", "x.md"]);
        assert_eq!(paths(9), paths(3));
        assert_eq!(paths(0), paths(1));
        let l = local_subgraph(&g, "a.md", 3, false);
        assert_eq!(l.notes.iter().find(|n| n.path == "d.md").unwrap().depth, 3);
    }

    #[test]
    fn edges_between_neighbours_are_kept_and_cycles_terminate() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "a.md", "[[b]] [[c]]");
        write(root, "b.md", "[[c]] [[a]]");
        write(root, "c.md", "[[a]]");
        let g = build_graph(root);
        let l = local_subgraph(&g, "a.md", 3, false);
        assert_eq!(l.notes.len(), 3);
        // a→b, a→c, b→c, b→a, c→a: all five live inside the neighbourhood.
        assert_eq!(l.wiki_edges.len(), 5);
    }

    #[test]
    fn aliases_and_titles_resolve_like_the_global_graph() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "ml.md", "---\naliases: [Машинное обучение]\n---\n");
        write(root, "t.md", "---\ntitle: Long Title\n---\n");
        write(root, "src.md", "[[машинное обучение]] and [[Long Title]]");
        let g = build_graph(root);
        let mut p: Vec<String> = local_subgraph(&g, "ml.md", 2, false)
            .notes
            .into_iter()
            .map(|n| n.path)
            .collect();
        p.sort();
        assert_eq!(p, vec!["ml.md", "src.md", "t.md"]);
    }

    #[test]
    fn tags_are_optional_leaves_counted_within_the_neighbourhood() {
        let dir = chain();
        let g = build_graph(dir.path());
        let l = local_subgraph(&g, "a.md", 1, true);
        assert_eq!(
            l.tags,
            vec![
                GraphTag {
                    tag: "ideas".into(),
                    count: 2
                },
                GraphTag {
                    tag: "work".into(),
                    count: 1
                }
            ]
        );
        assert_eq!(l.tag_edges.len(), 3);
        // Sharing a tag does not pull in more notes.
        assert_eq!(l.notes.len(), 3);
    }

    #[test]
    fn an_unknown_or_isolated_centre() {
        let dir = chain();
        let g = build_graph(dir.path());
        assert!(local_subgraph(&g, "missing.md", 2, true).notes.is_empty());
        let l = local_subgraph(&g, "lonely.md", 3, false);
        assert_eq!(local_paths(&l), vec![("lonely.md".into(), 0)]);
        assert!(l.wiki_edges.is_empty());
    }
}
