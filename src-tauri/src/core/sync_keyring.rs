use std::path::Path;

use anyhow::{Context, Result};
use keyring::Entry;
use sha2::{Digest, Sha256};

const SERVICE: &str = "mycel";

fn account_for(vault_path: &Path) -> String {
    let canonical = std::fs::canonicalize(vault_path)
        .unwrap_or_else(|_| vault_path.to_path_buf())
        .to_string_lossy()
        .to_string();
    let mut hasher = Sha256::new();
    hasher.update(canonical.as_bytes());
    let digest = hasher.finalize();
    format!("vault:{:x}", digest)
}

fn entry(vault_path: &Path) -> Result<Entry> {
    Entry::new(SERVICE, &account_for(vault_path)).context("Failed to open keyring entry")
}

pub fn set_token(vault_path: &Path, token: &str) -> Result<()> {
    entry(vault_path)?
        .set_password(token)
        .context("Failed to store token in keyring")
}

pub fn get_token(vault_path: &Path) -> Result<Option<String>> {
    match entry(vault_path)?.get_password() {
        Ok(t) => Ok(Some(t)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(anyhow::anyhow!(e).context("Failed to read token from keyring")),
    }
}

pub fn clear_token(vault_path: &Path) -> Result<()> {
    match entry(vault_path)?.delete_credential() {
        Ok(()) => Ok(()),
        Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(anyhow::anyhow!(e).context("Failed to remove token from keyring")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn account_is_stable_and_hex() {
        let a = account_for(&PathBuf::from("/tmp/some-vault"));
        let b = account_for(&PathBuf::from("/tmp/some-vault"));
        assert_eq!(a, b);
        assert!(a.starts_with("vault:"));
        assert_eq!(a.len(), "vault:".len() + 64);
    }

    #[test]
    fn account_differs_per_path() {
        let a = account_for(&PathBuf::from("/tmp/vault-a"));
        let b = account_for(&PathBuf::from("/tmp/vault-b"));
        assert_ne!(a, b);
    }
}
