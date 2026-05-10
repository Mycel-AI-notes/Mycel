use std::path::{Path, PathBuf};
use anyhow::{Context, Result};
use serde::{Deserialize, Serialize};

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

        Ok(Self { root })
    }

    pub fn file_tree(&self) -> Result<Vec<FileEntry>> {
        read_dir_recursive(&self.root, &self.root)
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
            entries.push(FileEntry {
                name,
                path: rel_path,
                is_dir: true,
                children: Some(children),
            });
        } else if path.extension().map(|e| e == "md").unwrap_or(false) {
            entries.push(FileEntry {
                name,
                path: rel_path,
                is_dir: false,
                children: None,
            });
        }
    }

    Ok(entries)
}
