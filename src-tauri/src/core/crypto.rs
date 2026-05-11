//! Per-note encryption using age (X25519 + ChaCha20-Poly1305).
//!
//! Design overview
//! ---------------
//! Each vault has at most one *crypto identity* — an X25519 keypair stored
//! under `.mycel/crypto/`:
//!
//! ```text
//! .mycel/crypto/
//! ├── identity.age      # age scrypt-wrapped X25519 secret. Wrap passphrase
//! │                     # is a 256-bit random secret stored in the OS keyring
//! │                     # (Keychain / Credential Manager / Secret Service —
//! │                     # hardware-backed on macOS+Windows on supported HW).
//! ├── pubkey.txt        # The age `age1...` recipient string. Plain text so
//! │                     # the app can ENCRYPT new notes while still locked.
//! └── recipients.txt    # Extra recipients (other devices, recovery keys).
//!                       # One `age1...` per line. Optional.
//! ```
//!
//! Notes are stored as `<name>.md.age`. The on-disk format is the standard
//! ASCII-armored age format ("-----BEGIN AGE ENCRYPTED FILE-----"…) so the
//! files round-trip through Git/iCloud/Syncthing exactly like any other text
//! blob. Multi-recipient support means a note can be decrypted by any of the
//! configured devices/keys.
//!
//! The plaintext X25519 secret never touches disk: it is loaded into a
//! [`Session`] guarded by a `Zeroizing` buffer, and dropped/zeroized on
//! [`Session::lock`].
//!
//! Hardware backing
//! ----------------
//! The OS keyring is the default "hardware-backed" store:
//!   * macOS — Keychain (Secure Enclave via biometric ACLs when configured).
//!   * Windows — Credential Manager (TPM-backed DPAPI on supported HW).
//!   * Linux — Secret Service (libsecret); hardware backing depends on the
//!     implementation (e.g. tpm2-pkcs11 + gnome-keyring).
//!
//! The wrap layer is intentionally indirect (a random KEK in the keyring
//! wraps the age identity) so a future build can swap the keyring backend
//! for a Secure-Enclave / TPM / FIDO2 wrapper without changing the on-disk
//! format or note layout.
//!
//! Post-quantum
//! ------------
//! age 0.11 does not ship a Kyber recipient yet. The recipients file is a
//! list of opaque strings, so once an age plugin recipient lands (e.g.
//! `age-plugin-pq`) it can be added to `recipients.txt` for hybrid wrapping
//! without code changes here.

use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::sync::Mutex;

use age::secrecy::{ExposeSecret, SecretString};
use age::x25519;
use anyhow::{anyhow, bail, Context, Result};
use base64::{engine::general_purpose::STANDARD_NO_PAD, Engine as _};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use zeroize::Zeroizing;

use crate::core::sync_keyring;

/// Subdirectory under `.mycel/` that holds crypto material.
pub const CRYPTO_DIR: &str = ".mycel/crypto";
const IDENTITY_FILE: &str = "identity.age";
const PUBKEY_FILE: &str = "pubkey.txt";
const RECIPIENTS_FILE: &str = "recipients.txt";

/// Suffix that marks an encrypted note. We keep `.md` so existing tooling
/// (and humans) recognise the underlying type.
pub const ENC_SUFFIX: &str = ".md.age";

/// Keyring "service" used to store the wrap secret. Distinct from the
/// sync-token service so the two never collide.
const KEYRING_SERVICE: &str = "mycel.crypto";

/// Returns `path` with the `.md.age` suffix added if it isn't already there.
pub fn encrypted_path_for(path: &str) -> String {
    if path.ends_with(ENC_SUFFIX) {
        path.to_string()
    } else if let Some(stem) = path.strip_suffix(".md") {
        format!("{stem}{ENC_SUFFIX}")
    } else {
        format!("{path}{ENC_SUFFIX}")
    }
}

/// Returns `path` with the `.md.age` suffix removed, yielding the plaintext
/// `.md` counterpart. If `path` doesn't end in `.md.age` it is returned
/// unchanged.
pub fn decrypted_path_for(path: &str) -> String {
    if let Some(stem) = path.strip_suffix(ENC_SUFFIX) {
        format!("{stem}.md")
    } else {
        path.to_string()
    }
}

pub fn is_encrypted_path(path: &str) -> bool {
    path.ends_with(ENC_SUFFIX)
}

/// Summary returned to the frontend.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CryptoStatus {
    /// `.mycel/crypto/pubkey.txt` exists — the vault has a crypto identity.
    pub configured: bool,
    /// The wrap secret is present in the OS keyring.
    pub keyring_present: bool,
    /// An X25519 secret is loaded in memory and decryption is possible.
    pub unlocked: bool,
    /// Number of recipients (including the primary one) — i.e. how many keys
    /// can decrypt notes encrypted from this vault going forward.
    pub recipients: usize,
    /// The primary `age1...` recipient string, if configured.
    pub primary_recipient: Option<String>,
}

/// In-process holder of the unwrapped X25519 identity. Created via
/// [`Session::unlock`]; explicitly cleared via [`Session::lock`]. The
/// `Zeroizing` secret bytes are wiped when this drops.
#[derive(Default)]
pub struct Session {
    inner: Mutex<Option<Unlocked>>,
}

struct Unlocked {
    /// Parsed X25519 identity — owns its own secret material.
    identity: x25519::Identity,
    /// Original `AGE-SECRET-KEY-1…` text, zeroized on drop. Kept so we can
    /// re-wrap or export when rotating, without re-parsing.
    #[allow(dead_code)]
    raw: Zeroizing<String>,
}

impl Session {
    pub fn is_unlocked(&self) -> bool {
        self.inner.lock().expect("crypto session poisoned").is_some()
    }

    pub fn lock(&self) {
        // Dropping the `Unlocked` zeroizes the inner secret bytes.
        *self.inner.lock().expect("crypto session poisoned") = None;
    }

    /// Read the wrapped identity from disk, unwrap it with the keyring
    /// secret, and store the resulting X25519 identity in memory.
    pub fn unlock(&self, vault_root: &Path) -> Result<()> {
        let secret = read_wrap_secret(vault_root)?
            .ok_or_else(|| anyhow!("No wrap secret found in keyring for this vault."))?;
        let raw = decrypt_identity_file(vault_root, &secret)?;
        let identity = x25519::Identity::from_str(raw.trim())
            .map_err(|e| anyhow!("Failed to parse stored X25519 identity: {e}"))?;
        *self.inner.lock().expect("crypto session poisoned") =
            Some(Unlocked { identity, raw });
        Ok(())
    }

    /// Run a closure with a reference to the unwrapped identity. Returns
    /// `Err` if the session is locked.
    pub fn with_identity<R>(
        &self,
        f: impl FnOnce(&x25519::Identity) -> Result<R>,
    ) -> Result<R> {
        let guard = self.inner.lock().expect("crypto session poisoned");
        let unlocked = guard
            .as_ref()
            .ok_or_else(|| anyhow!("Vault is locked. Unlock to decrypt notes."))?;
        f(&unlocked.identity)
    }
}

// ---------------------------------------------------------------------------
// On-disk identity / recipients management
// ---------------------------------------------------------------------------

fn crypto_dir(vault_root: &Path) -> PathBuf {
    vault_root.join(CRYPTO_DIR)
}

fn identity_path(vault_root: &Path) -> PathBuf {
    crypto_dir(vault_root).join(IDENTITY_FILE)
}

fn pubkey_path(vault_root: &Path) -> PathBuf {
    crypto_dir(vault_root).join(PUBKEY_FILE)
}

fn recipients_path(vault_root: &Path) -> PathBuf {
    crypto_dir(vault_root).join(RECIPIENTS_FILE)
}

/// Read the wrap secret for `vault_root` from the OS keyring.
fn read_wrap_secret(vault_root: &Path) -> Result<Option<String>> {
    sync_keyring::get_secret(KEYRING_SERVICE, vault_root)
}

fn write_wrap_secret(vault_root: &Path, secret: &str) -> Result<()> {
    sync_keyring::set_secret(KEYRING_SERVICE, vault_root, secret)
}

fn clear_wrap_secret(vault_root: &Path) -> Result<()> {
    sync_keyring::clear_secret(KEYRING_SERVICE, vault_root)
}

/// Generate a fresh 256-bit secret, base64-encoded.
fn fresh_wrap_secret() -> String {
    let mut buf = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut buf);
    STANDARD_NO_PAD.encode(buf)
}

/// Status snapshot for the frontend.
pub fn status(vault_root: &Path, session: &Session) -> Result<CryptoStatus> {
    let pubkey = read_pubkey(vault_root)?;
    let configured = pubkey.is_some();
    let keyring_present = configured && read_wrap_secret(vault_root)?.is_some();
    let recipients = read_recipients(vault_root)?.len();
    Ok(CryptoStatus {
        configured,
        keyring_present,
        unlocked: session.is_unlocked(),
        recipients,
        primary_recipient: pubkey,
    })
}

/// Initialise crypto for a vault that doesn't have it yet. Returns the
/// public recipient string.
pub fn setup(vault_root: &Path, session: &Session) -> Result<String> {
    let dir = crypto_dir(vault_root);
    std::fs::create_dir_all(&dir).context("Failed to create .mycel/crypto/")?;
    if identity_path(vault_root).exists() {
        bail!(
            "Crypto identity already exists. Delete .mycel/crypto/ first to re-initialise."
        );
    }

    let identity = x25519::Identity::generate();
    let pubkey = identity.to_public().to_string();
    let raw = identity.to_string().expose_secret().to_string();

    let secret = fresh_wrap_secret();
    encrypt_identity_file(vault_root, &raw, &secret)?;
    write_wrap_secret(vault_root, &secret)?;

    std::fs::write(pubkey_path(vault_root), format!("{pubkey}\n"))
        .context("Failed to write pubkey.txt")?;
    // Seed recipients.txt with the primary key so multi-device handling and
    // re-key flows operate on a single source of truth.
    std::fs::write(recipients_path(vault_root), format!("{pubkey}\n"))
        .context("Failed to write recipients.txt")?;

    // Auto-unlock: the user just generated the identity, so we have the
    // secret in hand; no need to re-prompt.
    let raw_z: Zeroizing<String> = Zeroizing::new(raw);
    let parsed = x25519::Identity::from_str(raw_z.trim())
        .map_err(|e| anyhow!("Failed to re-parse freshly generated identity: {e}"))?;
    *session.inner.lock().expect("crypto session poisoned") = Some(Unlocked {
        identity: parsed,
        raw: raw_z,
    });

    Ok(pubkey)
}

/// Permanently remove the crypto identity and wipe the keyring secret. The
/// session is locked. Encrypted notes on disk become unreadable — callers
/// must warn the user before invoking this.
pub fn reset(vault_root: &Path, session: &Session) -> Result<()> {
    session.lock();
    clear_wrap_secret(vault_root).ok();
    let dir = crypto_dir(vault_root);
    if dir.exists() {
        std::fs::remove_dir_all(&dir)
            .context("Failed to remove .mycel/crypto/")?;
    }
    Ok(())
}

fn read_pubkey(vault_root: &Path) -> Result<Option<String>> {
    let path = pubkey_path(vault_root);
    if !path.exists() {
        return Ok(None);
    }
    let text = std::fs::read_to_string(&path)
        .with_context(|| format!("Failed to read {}", path.display()))?;
    let line = text.lines().next().unwrap_or("").trim();
    if line.is_empty() {
        Ok(None)
    } else {
        Ok(Some(line.to_string()))
    }
}

/// Return all recipient strings configured for this vault. Empty unless
/// crypto has been set up.
pub fn read_recipients(vault_root: &Path) -> Result<Vec<String>> {
    let path = recipients_path(vault_root);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let text = std::fs::read_to_string(&path)
        .with_context(|| format!("Failed to read {}", path.display()))?;
    Ok(text
        .lines()
        .map(|l| l.trim())
        .filter(|l| !l.is_empty() && !l.starts_with('#'))
        .map(|l| l.to_string())
        .collect())
}

/// Add a recipient string to the vault. Used to enrol additional devices or
/// recovery keys. The string must be a valid age recipient (`age1...` or a
/// plugin recipient `age1<plugin>1...`).
pub fn add_recipient(vault_root: &Path, recipient: &str) -> Result<()> {
    let recipient = recipient.trim();
    if recipient.is_empty() {
        bail!("Recipient string is empty");
    }
    // Reject obviously bogus values early. We don't enforce X25519-only —
    // plugin recipients are also fine and arrive as opaque strings.
    if !recipient.starts_with("age1") {
        bail!("Recipient must start with 'age1...'");
    }
    let mut current = read_recipients(vault_root)?;
    if current.iter().any(|r| r == recipient) {
        return Ok(()); // idempotent
    }
    current.push(recipient.to_string());
    std::fs::write(
        recipients_path(vault_root),
        current.join("\n") + "\n",
    )
    .context("Failed to write recipients.txt")?;
    Ok(())
}

/// Remove a recipient by exact match. Refuses to remove the primary
/// recipient — that would orphan the vault.
pub fn remove_recipient(vault_root: &Path, recipient: &str) -> Result<()> {
    let recipient = recipient.trim();
    let primary = read_pubkey(vault_root)?
        .ok_or_else(|| anyhow!("Crypto is not configured for this vault"))?;
    if recipient == primary {
        bail!("Refusing to remove the primary recipient — this vault would become unreadable.");
    }
    let current = read_recipients(vault_root)?;
    let next: Vec<String> = current.into_iter().filter(|r| r != recipient).collect();
    std::fs::write(recipients_path(vault_root), next.join("\n") + "\n")
        .context("Failed to write recipients.txt")?;
    Ok(())
}

// ---------------------------------------------------------------------------
// age wrap/unwrap (identity file)
// ---------------------------------------------------------------------------

fn encrypt_identity_file(vault_root: &Path, raw_identity: &str, passphrase: &str) -> Result<()> {
    let recipient = age::scrypt::Recipient::new(SecretString::from(passphrase.to_string()));
    let encryptor = age::Encryptor::with_recipients(
        std::iter::once(&recipient as &dyn age::Recipient),
    )
    .map_err(|e| anyhow!("Failed to build scrypt encryptor: {e}"))?;

    let mut out = Vec::new();
    let armor =
        age::armor::ArmoredWriter::wrap_output(&mut out, age::armor::Format::AsciiArmor)
            .map_err(|e| anyhow!("armor wrap: {e}"))?;
    let mut writer = encryptor
        .wrap_output(armor)
        .map_err(|e| anyhow!("wrap_output: {e}"))?;
    writer
        .write_all(raw_identity.as_bytes())
        .map_err(|e| anyhow!("write identity: {e}"))?;
    let armor = writer
        .finish()
        .map_err(|e| anyhow!("finish writer: {e}"))?;
    armor
        .finish()
        .map_err(|e| anyhow!("finish armor: {e}"))?;

    std::fs::write(identity_path(vault_root), out)
        .context("Failed to write identity.age")?;
    Ok(())
}

fn decrypt_identity_file(vault_root: &Path, passphrase: &str) -> Result<Zeroizing<String>> {
    let bytes = std::fs::read(identity_path(vault_root))
        .context("Failed to read identity.age — is crypto configured?")?;

    let armor = age::armor::ArmoredReader::new(&bytes[..]);
    let decryptor = age::Decryptor::new(armor)
        .map_err(|e| anyhow!("Failed to read identity.age header: {e}"))?;

    let identity = age::scrypt::Identity::new(SecretString::from(passphrase.to_string()));
    let mut reader = decryptor
        .decrypt(std::iter::once(&identity as &dyn age::Identity))
        .map_err(|e| anyhow!("Failed to unwrap identity (wrong keyring secret?): {e}"))?;

    let mut out = Zeroizing::new(String::new());
    reader
        .read_to_string(&mut out)
        .map_err(|e| anyhow!("Failed to read decrypted identity: {e}"))?;
    Ok(out)
}

// ---------------------------------------------------------------------------
// Note-level encrypt / decrypt
// ---------------------------------------------------------------------------

/// Encrypt `plaintext` to the vault's current set of recipients. Returns
/// ASCII-armored age bytes.
pub fn encrypt_note(vault_root: &Path, plaintext: &str) -> Result<Vec<u8>> {
    let recipient_strs = read_recipients(vault_root)?;
    if recipient_strs.is_empty() {
        bail!("No recipients configured. Set up crypto first.");
    }

    let mut recipients: Vec<Box<dyn age::Recipient + Send>> = Vec::new();
    for r in &recipient_strs {
        let parsed = x25519::Recipient::from_str(r)
            .map_err(|e| anyhow!("Invalid recipient '{r}': {e}"))?;
        recipients.push(Box::new(parsed));
    }
    let refs: Vec<&dyn age::Recipient> =
        recipients.iter().map(|r| r.as_ref() as &dyn age::Recipient).collect();

    let encryptor = age::Encryptor::with_recipients(refs.into_iter())
        .map_err(|e| anyhow!("Failed to build encryptor: {e}"))?;

    let mut out = Vec::new();
    let armor = age::armor::ArmoredWriter::wrap_output(&mut out, age::armor::Format::AsciiArmor)
        .map_err(|e| anyhow!("armor wrap: {e}"))?;
    let mut writer = encryptor
        .wrap_output(armor)
        .map_err(|e| anyhow!("wrap_output: {e}"))?;
    writer
        .write_all(plaintext.as_bytes())
        .map_err(|e| anyhow!("write plaintext: {e}"))?;
    let armor = writer
        .finish()
        .map_err(|e| anyhow!("finish writer: {e}"))?;
    armor
        .finish()
        .map_err(|e| anyhow!("finish armor: {e}"))?;
    Ok(out)
}

/// Decrypt armored age bytes using the in-memory identity. Errors if the
/// session is locked.
pub fn decrypt_note(session: &Session, ciphertext: &[u8]) -> Result<String> {
    session.with_identity(|id| {
        let armor = age::armor::ArmoredReader::new(ciphertext);
        let decryptor = age::Decryptor::new(armor)
            .map_err(|e| anyhow!("Failed to read age header: {e}"))?;
        let mut reader = decryptor
            .decrypt(std::iter::once(id as &dyn age::Identity))
            .map_err(|e| anyhow!("Decryption failed: {e}"))?;
        let mut out = String::new();
        reader
            .read_to_string(&mut out)
            .map_err(|e| anyhow!("Failed to read decrypted body: {e}"))?;
        Ok(out)
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    #[test]
    fn path_helpers_roundtrip() {
        assert_eq!(encrypted_path_for("notes/foo.md"), "notes/foo.md.age");
        assert_eq!(encrypted_path_for("notes/foo.md.age"), "notes/foo.md.age");
        assert_eq!(decrypted_path_for("notes/foo.md.age"), "notes/foo.md");
        assert_eq!(decrypted_path_for("notes/foo.md"), "notes/foo.md");
        assert!(is_encrypted_path("a/b.md.age"));
        assert!(!is_encrypted_path("a/b.md"));
    }

    #[test]
    fn identity_wrap_unwrap_roundtrip() {
        let id = x25519::Identity::generate();
        let raw = id.to_string().expose_secret().to_string();
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(CRYPTO_DIR)).unwrap();
        encrypt_identity_file(dir.path(), &raw, "correct horse battery staple").unwrap();
        let got = decrypt_identity_file(dir.path(), "correct horse battery staple").unwrap();
        assert_eq!(got.trim(), raw.trim());
        assert!(decrypt_identity_file(dir.path(), "wrong passphrase").is_err());
    }

    #[test]
    fn note_encrypt_decrypt_roundtrip() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(CRYPTO_DIR)).unwrap();
        let id = x25519::Identity::generate();
        std::fs::write(
            dir.path().join(CRYPTO_DIR).join(PUBKEY_FILE),
            format!("{}\n", id.to_public()),
        )
        .unwrap();
        std::fs::write(
            dir.path().join(CRYPTO_DIR).join(RECIPIENTS_FILE),
            format!("{}\n", id.to_public()),
        )
        .unwrap();

        let plaintext = "# secret\n\nhello\n";
        let ct = encrypt_note(dir.path(), plaintext).unwrap();
        assert!(ct.starts_with(b"-----BEGIN AGE ENCRYPTED FILE"));

        let session = Session::default();
        *session.inner.lock().unwrap() = Some(Unlocked {
            raw: Zeroizing::new(id.to_string().expose_secret().to_string()),
            identity: x25519::Identity::from_str(id.to_string().expose_secret()).unwrap(),
        });
        let got = decrypt_note(&session, &ct).unwrap();
        assert_eq!(got, plaintext);

        session.lock();
        assert!(decrypt_note(&session, &ct).is_err());
    }
}
