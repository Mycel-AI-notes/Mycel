use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

/// Special vault folder where databases and the pages they generate live.
/// Auto-created on vault open and protected from rename/delete.
pub const KNOWLEDGE_BASE_DIR: &str = "Knowledge Base";

/// Inbox-style folder for fast capture via global shortcut. Notes are
/// nested by date (`quick/YYYY-MM-DD/HH-MM-SS.md`). Auto-created and
/// protected from rename/delete so the global shortcut always has a
/// target.
pub const QUICK_NOTES_DIR: &str = "quick";

/// Registry file under `.mycel/` that lists directories the user has
/// promoted to Knowledge Bases. See `docs/specs/kb-directory.md`.
pub const KB_DIRS_FILE: &str = "kb-dirs.json";

/// Registry file under `.mycel/` that remembers the user's manual ordering
/// of entries within a folder. Maps a vault-relative folder path (`""` for
/// the vault root) to the ordered list of child *names* the user arranged by
/// drag-and-drop. Entries not present in a list fall back to the default
/// "directories first, then alphabetical" order, appended after the
/// explicitly-ordered ones. Stale names (file deleted/moved) are simply
/// ignored, so the file is self-healing.
pub const TREE_ORDER_FILE: &str = "tree-order.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct VaultConfig {
    pub version: u32,
}

impl Default for VaultConfig {
    fn default() -> Self {
        Self { version: 1 }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KbEntry {
    /// Vault-relative path of the directory (forward slashes).
    pub path: String,
    /// Vault-relative path of the `.db.json` that backs the KB. Lives next to
    /// the directory, not inside it.
    pub db: String,
    /// ISO 8601 timestamp of activation.
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct KbDirsConfig {
    pub version: u32,
    #[serde(default)]
    pub dirs: Vec<KbEntry>,
}

impl Default for KbDirsConfig {
    fn default() -> Self {
        Self { version: 1, dirs: Vec::new() }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
    pub children: Option<Vec<FileEntry>>,
    /// True for the protected Knowledge Base root folder.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_knowledge_base: bool,
    /// True for the protected `quick/` capture folder.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_quick_notes: bool,
    /// True if this directory has been promoted to a Knowledge Base via
    /// `kb_init`. Distinct from `is_knowledge_base` (that one marks the
    /// single protected root folder named "Knowledge Base").
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_kb_dir: bool,
    /// True if this entry sits inside a promoted KB folder. Used by the
    /// UI to suppress actions that don't apply to KB descendants (e.g.
    /// "Превратить в базу знаний" — a KB can only be created at its
    /// own root).
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_inside_kb: bool,
    /// True if the file is an encrypted note (`*.md.age`). The UI uses this
    /// to render a lock icon and route reads through the decrypt path.
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub is_encrypted: bool,
}

pub struct Vault {
    pub root: PathBuf,
}

impl Vault {
    pub fn open(path: impl AsRef<Path>) -> Result<Self> {
        let root = path.as_ref().to_path_buf();
        anyhow::ensure!(root.is_dir(), "Vault path is not a directory: {:?}", root);

        let mycel_dir = root.join(".mycel");
        std::fs::create_dir_all(&mycel_dir).context("Failed to create .mycel directory")?;

        let config_path = mycel_dir.join("config.json");
        if !config_path.exists() {
            let config = VaultConfig::default();
            let json = serde_json::to_string_pretty(&config)?;
            std::fs::write(&config_path, json)?;
        }

        // Ensure the Knowledge Base folder exists. It hosts databases and the
        // pages generated from rows.
        let kb_dir = root.join(KNOWLEDGE_BASE_DIR);
        std::fs::create_dir_all(&kb_dir).context("Failed to create Knowledge Base directory")?;

        // Ensure the quick-capture folder exists so the global shortcut
        // always has a target on a fresh vault.
        let quick_dir = root.join(QUICK_NOTES_DIR);
        std::fs::create_dir_all(&quick_dir).context("Failed to create quick notes directory")?;

        Ok(Self { root })
    }

    pub fn file_tree(&self) -> Result<Vec<FileEntry>> {
        let kb_paths = read_kb_dirs(&self.root)
            .map(|c| c.dirs.into_iter().map(|e| e.path).collect::<HashSet<_>>())
            .unwrap_or_default();
        let order = read_tree_order(&self.root);
        read_dir_recursive(&self.root, &self.root, &kb_paths, &order, false)
    }
}

/// Hidden from the file tree but kept on disk. The user accesses
/// these through the inline image widget and the image tab view —
/// listing them in the sidebar would clutter the tree without giving
/// any extra interaction since they aren't editable as text.
pub const ATTACHMENTS_DIR: &str = "attachments";

/// Read the KB registry from `<root>/.mycel/kb-dirs.json`. Missing file or
/// parse error → return `None`; callers should treat that as an empty
/// registry rather than failing the whole tree scan.
pub fn read_kb_dirs(root: &Path) -> Option<KbDirsConfig> {
    let path = root.join(".mycel").join(KB_DIRS_FILE);
    let raw = std::fs::read_to_string(&path).ok()?;
    serde_json::from_str(&raw).ok()
}

/// Write the KB registry to `<root>/.mycel/kb-dirs.json`. Creates `.mycel/`
/// if it does not exist.
pub fn write_kb_dirs(root: &Path, config: &KbDirsConfig) -> Result<()> {
    let mycel_dir = root.join(".mycel");
    std::fs::create_dir_all(&mycel_dir).context("Failed to create .mycel directory")?;
    let path = mycel_dir.join(KB_DIRS_FILE);
    let json = serde_json::to_string_pretty(config)?;
    std::fs::write(&path, json).context("Failed to write kb-dirs.json")?;
    Ok(())
}

/// Read the manual tree-order registry from `<root>/.mycel/tree-order.json`.
/// Missing file or parse error → empty map (everything falls back to the
/// default sort).
pub fn read_tree_order(root: &Path) -> HashMap<String, Vec<String>> {
    let path = root.join(".mycel").join(TREE_ORDER_FILE);
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|raw| serde_json::from_str(&raw).ok())
        .unwrap_or_default()
}

/// Persist the manual tree-order registry. Creates `.mycel/` if needed.
pub fn write_tree_order(root: &Path, order: &HashMap<String, Vec<String>>) -> Result<()> {
    let mycel_dir = root.join(".mycel");
    std::fs::create_dir_all(&mycel_dir).context("Failed to create .mycel directory")?;
    let path = mycel_dir.join(TREE_ORDER_FILE);
    let json = serde_json::to_string_pretty(order)?;
    std::fs::write(&path, json).context("Failed to write tree-order.json")?;
    Ok(())
}

fn read_dir_recursive(
    dir: &Path,
    vault_root: &Path,
    kb_paths: &HashSet<String>,
    order: &HashMap<String, Vec<String>>,
    inside_kb: bool,
) -> Result<Vec<FileEntry>> {
    let mut entries: Vec<FileEntry> = Vec::new();

    // Read the directory once and precompute each entry's name and
    // directory-ness. `is_dir` is resolved here (one `stat` per entry, with
    // the same symlink-following semantics as `Path::is_dir`) so the sort
    // comparator below doesn't re-`stat` and re-allocate names on every
    // comparison — that turned a folder scan into O(n·log n) syscalls.
    struct ReadItem {
        entry: std::fs::DirEntry,
        name: String,
        is_dir: bool,
    }
    let mut read = std::fs::read_dir(dir)?
        .filter_map(|e| e.ok())
        .map(|e| {
            let is_dir = e.path().is_dir();
            let name = e.file_name().to_string_lossy().to_string();
            ReadItem { entry: e, name, is_dir }
        })
        .collect::<Vec<_>>();

    // The manual order (if any) is keyed by this folder's vault-relative path,
    // with "" standing for the vault root.
    let dir_rel = dir
        .strip_prefix(vault_root)
        .unwrap_or(dir)
        .to_string_lossy()
        .replace('\\', "/");
    let custom = order.get(&dir_rel);

    // Sort: honour the user's manual order first (explicitly-ordered entries
    // keep their arranged positions); anything not in the list falls back to
    // "dirs first, then alphabetical" and is appended after the ordered ones.
    read.sort_by(|a, b| {
        if let Some(list) = custom {
            let ai = list.iter().position(|n| n == &a.name);
            let bi = list.iter().position(|n| n == &b.name);
            match (ai, bi) {
                (Some(x), Some(y)) => return x.cmp(&y),
                (Some(_), None) => return std::cmp::Ordering::Less,
                (None, Some(_)) => return std::cmp::Ordering::Greater,
                (None, None) => {}
            }
        }
        if a.is_dir != b.is_dir {
            b.is_dir.cmp(&a.is_dir)
        } else {
            a.name.cmp(&b.name)
        }
    });

    for item in read {
        let ReadItem { entry, name, is_dir } = item;
        let path = entry.path();

        // Skip hidden dirs (except within content), skip .mycel entirely
        if name.starts_with('.') {
            continue;
        }

        let rel_path = path
            .strip_prefix(vault_root)
            .unwrap_or(&path)
            .to_string_lossy()
            .to_string();

        // The attachments folder is intentionally hidden from the tree
        // — images are surfaced inline in notes and through the image
        // tab view, never as standalone tree entries.
        if rel_path == ATTACHMENTS_DIR {
            continue;
        }

        if is_dir {
            let is_kb_dir = kb_paths.contains(&rel_path);
            // Descendants of a KB folder inherit the `is_inside_kb`
            // flag so the UI knows to suppress KB-creation actions on
            // them. The KB root itself is not "inside" — it _is_ the
            // KB — so `inside_kb` for its children becomes `true` only
            // one level down.
            let child_inside_kb = inside_kb || is_kb_dir;
            let mut children =
                read_dir_recursive(&path, vault_root, kb_paths, order, child_inside_kb)?;
            let is_kb = rel_path == KNOWLEDGE_BASE_DIR;
            let is_quick = rel_path == QUICK_NOTES_DIR;
            // For KB-promoted directories, the `index.md` is the KB page
            // itself — surfaced by clicking the folder. Hide it from the
            // file tree so it doesn't clutter the sidebar.
            if is_kb_dir {
                let index_rel = format!("{rel_path}/index.md");
                children.retain(|c| c.path != index_rel);
            }
            entries.push(FileEntry {
                name,
                path: rel_path,
                is_dir: true,
                children: Some(children),
                is_knowledge_base: is_kb,
                is_quick_notes: is_quick,
                is_kb_dir,
                is_inside_kb: inside_kb,
                is_encrypted: false,
            });
        } else {
            let is_md = path.extension().map(|e| e == "md").unwrap_or(false);
            let is_age = rel_path.ends_with(".md.age");
            if is_md || is_age {
                entries.push(FileEntry {
                    name,
                    path: rel_path,
                    is_dir: false,
                    children: None,
                    is_knowledge_base: false,
                    is_quick_notes: false,
                    is_kb_dir: false,
                    is_inside_kb: inside_kb,
                    is_encrypted: is_age,
                });
            }
        }
    }

    Ok(entries)
}
