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
        read_dir_recursive(&self.root, &self.root)
    }
}

/// Image extensions we render inline in the editor. Listing them here
/// (rather than allowing every non-markdown file) keeps the tree free
/// of `.DS_Store` and other junk that may live alongside attachments.
const ATTACHMENT_EXTS: &[&str] = &["png", "jpg", "jpeg", "gif", "webp", "svg"];

fn is_attachment_path(rel_path: &str, full_path: &Path) -> bool {
    // `attachments/foo.png` is the canonical place, but the user may
    // already have images scattered elsewhere — surface those too so
    // tree completeness doesn't depend on where the file landed.
    let _ = rel_path;
    let ext = full_path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_lowercase());
    match ext {
        Some(e) => ATTACHMENT_EXTS.iter().any(|x| *x == e),
        None => false,
    }
}

fn read_dir_recursive(dir: &Path, vault_root: &Path) -> Result<Vec<FileEntry>> {
    let mut entries: Vec<FileEntry> = Vec::new();

    let mut read = std::fs::read_dir(dir)?
        .filter_map(|e| e.ok())
        .collect::<Vec<_>>();

    // Sort: dirs first, then files, both alphabetically
    read.sort_by(|a, b| {
        let a_dir = a.path().is_dir();
        let b_dir = b.path().is_dir();
        if a_dir != b_dir {
            b_dir.cmp(&a_dir)
        } else {
            a.file_name().cmp(&b.file_name())
        }
    });

    for entry in read {
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        // Skip hidden dirs (except within content), skip .mycel entirely
        if name.starts_with('.') {
            continue;
        }

        let rel_path = path
            .strip_prefix(vault_root)
            .unwrap_or(&path)
            .to_string_lossy()
            .to_string();

        if path.is_dir() {
            let children = read_dir_recursive(&path, vault_root)?;
            let is_kb = rel_path == KNOWLEDGE_BASE_DIR;
            let is_quick = rel_path == QUICK_NOTES_DIR;
            entries.push(FileEntry {
                name,
                path: rel_path,
                is_dir: true,
                children: Some(children),
                is_knowledge_base: is_kb,
                is_quick_notes: is_quick,
                is_encrypted: false,
            });
        } else {
            let is_md = path.extension().map(|e| e == "md").unwrap_or(false);
            let is_age = rel_path.ends_with(".md.age");
            // Show binary attachments in the tree too so the user can
            // see what landed in `attachments/` after a drag-and-drop
            // and so the file actions (rename / delete / reveal in
            // OS) work on them like on notes.
            let is_attachment = is_attachment_path(&rel_path, &path);
            if is_md || is_age || is_attachment {
                entries.push(FileEntry {
                    name,
                    path: rel_path,
                    is_dir: false,
                    children: None,
                    is_knowledge_base: false,
                    is_quick_notes: false,
                    is_encrypted: is_age,
                });
            }
        }
    }

    Ok(entries)
}
