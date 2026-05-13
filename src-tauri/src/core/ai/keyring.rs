//! Thin wrapper around `core::sync_keyring` for the OpenRouter API key.
//!
//! Separate service name so it's stored as a distinct credential from the
//! GitHub sync PAT, but keyed by the same vault-path hash so multi-vault
//! users get isolated keys per vault.

use std::path::Path;

use anyhow::Result;

use crate::core::sync_keyring;

const SERVICE: &str = "mycel-openrouter";

pub fn set_key(vault_path: &Path, key: &str) -> Result<()> {
    sync_keyring::set_secret(SERVICE, vault_path, key)
}

pub fn get_key(vault_path: &Path) -> Result<Option<String>> {
    sync_keyring::get_secret(SERVICE, vault_path)
}

pub fn clear_key(vault_path: &Path) -> Result<()> {
    sync_keyring::clear_secret(SERVICE, vault_path)
}
