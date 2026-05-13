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
/// This device's wrapped X25519 secret. Gitignored — every device that
/// joins the vault has its own.
const IDENTITY_FILE: &str = "local-identity.age";
/// This device's age public key. Gitignored — derived from the local
/// identity. Stored separately so status can report it without
/// requiring an unlocked session.
const PUBKEY_FILE: &str = "local-pubkey.txt";
/// All public keys allowed to decrypt notes in this vault. Committed
/// to git so devices can discover each other. Append-only in normal
/// flow; removed via the Manage panel.
const RECIPIENTS_FILE: &str = "recipients.txt";
/// Legacy file names from before multi-device support. Migrated on
/// first vault load.
const LEGACY_IDENTITY_FILE: &str = "identity.age";
const LEGACY_PUBKEY_FILE: &str = "pubkey.txt";
const GITIGNORE_FILE: &str = ".gitignore";
const GITIGNORE_CONTENTS: &str = "# Per-device crypto material — do not sync these between machines.\n\
                                  # Each device generates its own; recipients.txt is the shared truth.\n\
                                  local-identity.age\n\
                                  local-pubkey.txt\n";
/// Marker that survives KEK-unwrap and tells us the inner layer is
/// passphrase-wrapped. Anything else (notably the raw `AGE-SECRET-KEY-1…`
/// of legacy single-wrap vaults) is treated as "no passphrase set".
const PASSPHRASE_INNER_PREFIX: &[u8] = b"age-encryption.org/v1";

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
    /// `recipients.txt` exists and lists at least one pubkey — some
    /// device has enrolled crypto in this vault (not necessarily this
    /// one).
    pub configured: bool,
    /// This device has a usable local identity: the wrapped file is on
    /// disk AND the matching KEK is in the OS keyring. A stray file
    /// pulled from git without a keyring entry does NOT count.
    pub local_identity_present: bool,
    /// The wrap secret is present in the OS keyring.
    pub keyring_present: bool,
    /// An X25519 secret is loaded in memory and decryption is possible.
    pub unlocked: bool,
    /// Number of recipients in `recipients.txt` — how many keys can
    /// decrypt notes encrypted from this vault going forward.
    pub recipients: usize,
    /// This device's `age1...` public key, if it has joined the vault.
    pub primary_recipient: Option<String>,
    /// True if the identity file is double-wrapped (KEK + passphrase). When
    /// false the vault was set up before the passphrase requirement (or with
    /// it explicitly disabled), so `Lock` doesn't actually protect anything
    /// — the keyring re-unlocks silently. The UI surfaces this and offers a
    /// "Set passphrase" CTA.
    pub has_passphrase: bool,
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

    /// Read the wrapped identity from disk and unwrap it.
    ///
    /// Two on-disk formats are supported:
    ///   * **Double-wrap** (`scrypt(KEK, scrypt(passphrase, X25519))`) —
    ///     created by `setup` when the user chose a passphrase. Unlock
    ///     needs both factors.
    ///   * **Single-wrap** (`scrypt(KEK, X25519)`) — legacy / opt-out.
    ///     Pass an empty `passphrase`; only the KEK is required. The
    ///     keyring still binds the identity to this device, but `Lock`
    ///     doesn't actually deny access (the keyring re-unlocks
    ///     silently). Status reports `has_passphrase: false` so the UI
    ///     can warn and offer `set_passphrase` to upgrade in place.
    ///
    /// `on_stage` is called between major steps so callers (e.g. the
    /// Tauri command layer) can surface real progress while the slow
    /// scrypt passes run. Stage names: `"keyring"`, `"outer"`,
    /// `"passphrase"` (only when double-wrap), `"identity"`.
    pub fn unlock(
        &self,
        vault_root: &Path,
        passphrase: &str,
        on_stage: &dyn Fn(&str),
    ) -> Result<()> {
        on_stage("keyring");
        let kek = read_wrap_secret(vault_root)?
            .ok_or_else(|| anyhow!("No wrap secret found in keyring for this vault."))?;
        let raw = decrypt_identity_file(vault_root, &kek, passphrase, on_stage)?;
        on_stage("identity");
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

/// Migrate single-device layout (`identity.age`, `pubkey.txt`) to the
/// per-device layout (`local-identity.age`, `local-pubkey.txt` plus a
/// `.gitignore`). Idempotent — re-running is a no-op once migrated.
///
/// Called from `status()` so it runs the first time the frontend asks
/// about crypto state; no special vault-open hook needed.
fn ensure_layout(vault_root: &Path) -> Result<()> {
    let dir = crypto_dir(vault_root);
    if !dir.exists() {
        return Ok(());
    }

    let legacy_identity = dir.join(LEGACY_IDENTITY_FILE);
    let new_identity = dir.join(IDENTITY_FILE);
    if legacy_identity.exists() && !new_identity.exists() {
        std::fs::rename(&legacy_identity, &new_identity)
            .with_context(|| format!("Failed to migrate {LEGACY_IDENTITY_FILE} → {IDENTITY_FILE}"))?;
    }

    let legacy_pubkey = dir.join(LEGACY_PUBKEY_FILE);
    let new_pubkey = dir.join(PUBKEY_FILE);
    if legacy_pubkey.exists() && !new_pubkey.exists() {
        std::fs::rename(&legacy_pubkey, &new_pubkey)
            .with_context(|| format!("Failed to migrate {LEGACY_PUBKEY_FILE} → {PUBKEY_FILE}"))?;
    }

    let gitignore = dir.join(GITIGNORE_FILE);
    let needs_write = match std::fs::read_to_string(&gitignore) {
        Ok(current) => !current.contains("local-identity.age"),
        Err(_) => true,
    };
    if needs_write {
        std::fs::write(&gitignore, GITIGNORE_CONTENTS)
            .with_context(|| format!("Failed to write {}", gitignore.display()))?;
    }

    Ok(())
}

/// Status snapshot for the frontend.
pub fn status(vault_root: &Path, session: &Session) -> Result<CryptoStatus> {
    ensure_layout(vault_root)?;

    let recipients = read_recipients(vault_root)?;
    let configured = !recipients.is_empty();

    let id_exists = identity_path(vault_root).exists();
    let keyring_present = read_wrap_secret(vault_root)?.is_some();
    // "This device is enrolled" requires BOTH the wrapped file and a
    // matching keyring entry. A stray identity.age pulled via git from
    // another device is unusable without that device's KEK.
    let local_identity_present = id_exists && keyring_present;

    let primary_recipient = if id_exists {
        read_pubkey(vault_root)?
    } else {
        None
    };
    let has_passphrase =
        id_exists && keyring_present && identity_has_passphrase(vault_root).unwrap_or(false);

    Ok(CryptoStatus {
        configured,
        local_identity_present,
        keyring_present,
        unlocked: session.is_unlocked(),
        recipients: recipients.len(),
        primary_recipient,
        has_passphrase,
    })
}

/// Cheap format probe — reads the outer scrypt envelope's header and
/// peeks at the inner bytes. Does NOT require an unlocked session and
/// returns `false` if the file isn't readable for any reason.
///
/// Implemented by running the outer KEK-unwrap and sniffing the result:
/// a double-wrap vault yields another age envelope (begins with
/// `age-encryption.org/v1`), a legacy single-wrap vault yields the raw
/// `AGE-SECRET-KEY-1…` text. We accept the scrypt cost (~100 ms) — this
/// is called once per `status` call, which itself happens on demand.
fn identity_has_passphrase(vault_root: &Path) -> Result<bool> {
    let kek = match read_wrap_secret(vault_root)? {
        Some(k) => k,
        None => return Ok(false),
    };
    let bytes = std::fs::read(identity_path(vault_root))?;
    let inner = scrypt_unwrap_bytes(&bytes, &kek, true)?;
    Ok(inner.starts_with(PASSPHRASE_INNER_PREFIX))
}

/// Enrol this device in the vault. Handles both the first-device case
/// (`recipients.txt` empty/missing → vault is fresh) and the join case
/// (`recipients.txt` already lists other devices → we append).
///
/// Pass an empty `passphrase` to opt out — the identity file is wrapped
/// only by the keyring KEK. This is faster and friction-free but Lock
/// won't actually deny access (the OS keyring re-unlocks silently). The
/// UI surfaces `has_passphrase: false` so the user knows what they
/// signed up for, and `set_passphrase` upgrades to double-wrap later.
///
/// Returns the public recipient string for this device.
pub fn setup(
    vault_root: &Path,
    session: &Session,
    passphrase: &str,
    on_stage: &dyn Fn(&str),
) -> Result<String> {
    if !passphrase.is_empty() && passphrase.len() < 8 {
        bail!("Passphrase must be at least 8 characters (or empty to skip).");
    }
    let dir = crypto_dir(vault_root);
    std::fs::create_dir_all(&dir).context("Failed to create .mycel/crypto/")?;
    ensure_layout(vault_root)?;

    // Refuse only if this device is *already* enrolled (wrapped file +
    // matching keyring entry). A stray local-identity.age pulled from
    // git without a matching KEK is overwritten — it's not ours.
    if identity_path(vault_root).exists() && read_wrap_secret(vault_root)?.is_some() {
        bail!(
            "This device is already enrolled in this vault. Use 'Delete identity' first to re-initialise."
        );
    }

    on_stage("keypair");
    let identity = x25519::Identity::generate();
    let pubkey = identity.to_public().to_string();
    let raw = identity.to_string().expose_secret().to_string();

    let kek = fresh_wrap_secret();
    // `encrypt_identity_file` emits "wrap-passphrase" (if any) and
    // "wrap-keyring" itself — those are the two slow scrypt passes the
    // user is waiting on.
    encrypt_identity_file(vault_root, &raw, &kek, passphrase, on_stage)?;
    on_stage("store");
    write_wrap_secret(vault_root, &kek)?;

    std::fs::write(pubkey_path(vault_root), format!("{pubkey}\n"))
        .context("Failed to write local-pubkey.txt")?;
    // Append our pubkey to the (possibly already-populated)
    // recipients.txt. add_recipient is idempotent and creates the file
    // if it doesn't exist yet.
    add_recipient(vault_root, &pubkey)?;

    // Auto-unlock: the user just typed the passphrase and we have the raw
    // secret in hand, so move it straight into the session.
    let raw_z: Zeroizing<String> = Zeroizing::new(raw);
    let parsed = x25519::Identity::from_str(raw_z.trim())
        .map_err(|e| anyhow!("Failed to re-parse freshly generated identity: {e}"))?;
    *session.inner.lock().expect("crypto session poisoned") = Some(Unlocked {
        identity: parsed,
        raw: raw_z,
    });

    Ok(pubkey)
}

/// Remove this device's local identity (and wipe its keyring KEK).
/// The session is locked. Other devices listed in `recipients.txt` are
/// unaffected — they keep working independently.
///
/// If this device's pubkey was in `recipients.txt`, it is removed so
/// future notes are no longer encrypted to a key nobody has. Notes
/// already on disk that were encrypted to this device's pubkey only
/// become unreadable here — callers must warn the user beforehand.
pub fn reset(vault_root: &Path, session: &Session) -> Result<()> {
    let local_pubkey = read_pubkey(vault_root).ok().flatten();

    session.lock();
    clear_wrap_secret(vault_root).ok();

    // Best-effort removal of just our per-device files. We do NOT
    // delete the whole crypto dir — recipients.txt and the gitignore
    // are shared with other devices.
    let dir = crypto_dir(vault_root);
    for f in [IDENTITY_FILE, PUBKEY_FILE] {
        let p = dir.join(f);
        if p.exists() {
            std::fs::remove_file(&p)
                .with_context(|| format!("Failed to remove {}", p.display()))?;
        }
    }

    // Drop ourselves from the shared recipient list so future
    // encryptions don't include a pubkey nobody can use.
    if let Some(pk) = local_pubkey {
        let remaining: Vec<String> = read_recipients(vault_root)?
            .into_iter()
            .filter(|r| r != &pk)
            .collect();
        if remaining.is_empty() {
            // We were the only device — nuke recipients.txt so the
            // vault returns to a clean "no crypto" state.
            let _ = std::fs::remove_file(recipients_path(vault_root));
        } else {
            std::fs::write(
                recipients_path(vault_root),
                remaining.join("\n") + "\n",
            )
            .context("Failed to update recipients.txt")?;
        }
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

/// Remove a recipient by exact match. Refuses to leave `recipients.txt`
/// empty (that would make every future note unreadable for everyone).
/// Removing your own pubkey is allowed — other devices keep working,
/// you just stop receiving access on future encrypts here.
pub fn remove_recipient(vault_root: &Path, recipient: &str) -> Result<()> {
    let recipient = recipient.trim();
    let current = read_recipients(vault_root)?;
    let next: Vec<String> = current.into_iter().filter(|r| r != recipient).collect();
    if next.is_empty() {
        bail!("Refusing to remove the last recipient — the vault would have no readers.");
    }
    std::fs::write(recipients_path(vault_root), next.join("\n") + "\n")
        .context("Failed to write recipients.txt")?;
    Ok(())
}

// ---------------------------------------------------------------------------
// age wrap/unwrap (identity file)
// ---------------------------------------------------------------------------

/// Wrap raw X25519 secret in one or two scrypt envelopes.
///
/// With a non-empty passphrase: `scrypt(kek, scrypt(passphrase, raw))`.
/// The **inner** envelope is keyed by the user passphrase (never
/// persisted), the **outer** by the keyring KEK (binds to this device).
///
/// With an empty passphrase: `scrypt(kek, raw)` — single-wrap. Faster
/// and one less thing to remember, but Lock provides no protection
/// from someone at this device since the OS keyring re-unlocks
/// silently. Status surfaces this; the UI offers `set_passphrase` to
/// upgrade later without rotating the X25519 secret.
///
/// Only the outer envelope is armored so the file round-trips through
/// Git as text.
fn encrypt_identity_file(
    vault_root: &Path,
    raw_identity: &str,
    kek: &str,
    passphrase: &str,
    on_stage: &dyn Fn(&str),
) -> Result<()> {
    let inner: Vec<u8> = if passphrase.is_empty() {
        raw_identity.as_bytes().to_vec()
    } else {
        on_stage("wrap-passphrase");
        scrypt_wrap_bytes(raw_identity.as_bytes(), passphrase, false)?
    };
    on_stage("wrap-keyring");
    let outer = scrypt_wrap_bytes(&inner, kek, true)?;
    std::fs::write(identity_path(vault_root), outer)
        .context("Failed to write identity.age")?;
    Ok(())
}

fn decrypt_identity_file(
    vault_root: &Path,
    kek: &str,
    passphrase: &str,
    on_stage: &dyn Fn(&str),
) -> Result<Zeroizing<String>> {
    let bytes = std::fs::read(identity_path(vault_root))
        .context("Failed to read identity.age — is crypto configured?")?;
    on_stage("outer");
    // Outer: KEK. A failure here means the keyring secret doesn't match
    // — usually a vault copied between devices without keyring transfer.
    let inner = scrypt_unwrap_bytes(&bytes, kek, true)
        .map_err(|e| anyhow!("Keyring secret rejected the identity file: {e}"))?;

    // Sniff the inner bytes. A double-wrap vault yields another age
    // envelope (begins with `age-encryption.org/v1`). A single-wrap
    // vault yields the raw X25519 secret directly.
    let needs_passphrase = inner.starts_with(PASSPHRASE_INNER_PREFIX);

    let raw_bytes = if needs_passphrase {
        if passphrase.is_empty() {
            bail!("This vault is protected with a passphrase. Enter it to unlock.");
        }
        on_stage("passphrase");
        scrypt_unwrap_bytes(&inner, passphrase, false)
            .map_err(|_| anyhow!("Wrong passphrase."))?
    } else {
        // Single-wrap: ignore any passphrase the caller passed and return
        // the raw secret directly.
        inner
    };

    let mut out = Zeroizing::new(String::new());
    out.push_str(
        std::str::from_utf8(&raw_bytes)
            .map_err(|e| anyhow!("Decrypted identity is not valid UTF-8: {e}"))?,
    );
    Ok(out)
}

/// Upgrade a legacy single-wrap identity to double-wrap by adding a
/// passphrase. The X25519 secret is preserved — existing `.md.age`
/// notes keep working. Requires the session to be unlocked.
pub fn set_passphrase(
    vault_root: &Path,
    session: &Session,
    new_passphrase: &str,
) -> Result<()> {
    if new_passphrase.len() < 8 {
        bail!("Passphrase must be at least 8 characters.");
    }
    let kek = read_wrap_secret(vault_root)?
        .ok_or_else(|| anyhow!("No wrap secret in keyring — cannot re-wrap identity."))?;
    session.with_identity(|id| {
        let raw = id.to_string().expose_secret().to_string();
        encrypt_identity_file(vault_root, &raw, &kek, new_passphrase, &|_| {})?;
        Ok(())
    })
}

fn scrypt_wrap_bytes(plaintext: &[u8], passphrase: &str, armored: bool) -> Result<Vec<u8>> {
    let recipient = age::scrypt::Recipient::new(SecretString::from(passphrase.to_string()));
    let encryptor = age::Encryptor::with_recipients(
        std::iter::once(&recipient as &dyn age::Recipient),
    )
    .map_err(|e| anyhow!("Failed to build scrypt encryptor: {e}"))?;

    let mut out = Vec::new();
    if armored {
        let armor = age::armor::ArmoredWriter::wrap_output(&mut out, age::armor::Format::AsciiArmor)
            .map_err(|e| anyhow!("armor wrap: {e}"))?;
        let mut writer = encryptor
            .wrap_output(armor)
            .map_err(|e| anyhow!("wrap_output: {e}"))?;
        writer
            .write_all(plaintext)
            .map_err(|e| anyhow!("write: {e}"))?;
        let armor = writer.finish().map_err(|e| anyhow!("finish writer: {e}"))?;
        armor.finish().map_err(|e| anyhow!("finish armor: {e}"))?;
    } else {
        let mut writer = encryptor
            .wrap_output(&mut out)
            .map_err(|e| anyhow!("wrap_output: {e}"))?;
        writer
            .write_all(plaintext)
            .map_err(|e| anyhow!("write: {e}"))?;
        writer.finish().map_err(|e| anyhow!("finish writer: {e}"))?;
    }
    Ok(out)
}

fn scrypt_unwrap_bytes(ciphertext: &[u8], passphrase: &str, armored: bool) -> Result<Vec<u8>> {
    let identity = age::scrypt::Identity::new(SecretString::from(passphrase.to_string()));
    let mut out = Vec::new();
    if armored {
        let armor = age::armor::ArmoredReader::new(ciphertext);
        let decryptor = age::Decryptor::new(armor)
            .map_err(|e| anyhow!("Failed to read header: {e}"))?;
        let mut reader = decryptor
            .decrypt(std::iter::once(&identity as &dyn age::Identity))
            .map_err(|e| anyhow!("scrypt decrypt: {e}"))?;
        reader.read_to_end(&mut out).map_err(|e| anyhow!("read: {e}"))?;
    } else {
        let decryptor = age::Decryptor::new(ciphertext)
            .map_err(|e| anyhow!("Failed to read header: {e}"))?;
        let mut reader = decryptor
            .decrypt(std::iter::once(&identity as &dyn age::Identity))
            .map_err(|e| anyhow!("scrypt decrypt: {e}"))?;
        reader.read_to_end(&mut out).map_err(|e| anyhow!("read: {e}"))?;
    }
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

/// Re-encrypt every `*.md.age` in the vault to the current recipient
/// set. Used after a new device joins (so old notes become readable on
/// it) or after a key is rotated/removed. Requires the session to be
/// unlocked — we have to decrypt each note before re-wrapping it.
///
/// Notes that fail to decrypt with our identity are skipped (they were
/// encrypted to a recipient we no longer hold the secret for); they are
/// included in the returned skipped count instead of aborting the run.
/// Atomic per file: ciphertext is staged as `<name>.md.age.tmp` then
/// renamed over the original, so a crash mid-rewrap can't corrupt a
/// note.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ReencryptReport {
    pub rewrapped: usize,
    pub skipped: usize,
    pub failed_paths: Vec<String>,
}

pub fn reencrypt_all(vault_root: &Path, session: &Session) -> Result<ReencryptReport> {
    use walkdir::WalkDir;

    let recipients_count = read_recipients(vault_root)?.len();
    if recipients_count == 0 {
        bail!("No recipients configured — set up crypto first.");
    }

    let mut rewrapped = 0usize;
    let mut skipped = 0usize;
    let mut failed_paths = Vec::new();

    let mycel_dir = vault_root.join(".mycel");
    for entry in WalkDir::new(vault_root).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.starts_with(&mycel_dir) {
            continue;
        }
        if !path.is_file()
            || !path.to_string_lossy().ends_with(ENC_SUFFIX)
        {
            continue;
        }

        let cipher = match std::fs::read(path) {
            Ok(b) => b,
            Err(_) => {
                skipped += 1;
                failed_paths.push(path.display().to_string());
                continue;
            }
        };
        let plaintext = match decrypt_note(session, &cipher) {
            Ok(p) => p,
            Err(_) => {
                // Encrypted to a recipient set we no longer hold a
                // matching key for. Leave the file alone.
                skipped += 1;
                failed_paths.push(path.display().to_string());
                continue;
            }
        };
        let new_cipher = encrypt_note(vault_root, &plaintext)?;

        // Stage + atomic rename so a crash mid-write can't truncate the
        // original.
        let tmp = path.with_extension("age.tmp");
        std::fs::write(&tmp, &new_cipher).with_context(|| {
            format!("Failed to write {}", tmp.display())
        })?;
        std::fs::rename(&tmp, path).with_context(|| {
            format!("Failed to rename {} → {}", tmp.display(), path.display())
        })?;
        rewrapped += 1;
    }

    Ok(ReencryptReport { rewrapped, skipped, failed_paths })
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
        encrypt_identity_file(dir.path(), &raw, "kek-secret-32-bytes", "correct horse battery", &|_| {}).unwrap();
        // Both factors required: right kek + right passphrase succeeds.
        let got =
            decrypt_identity_file(dir.path(), "kek-secret-32-bytes", "correct horse battery", &|_| {}).unwrap();
        assert_eq!(got.trim(), raw.trim());
        // Wrong passphrase fails.
        assert!(decrypt_identity_file(dir.path(), "kek-secret-32-bytes", "wrong", &|_| {}).is_err());
        // Wrong KEK fails even with right passphrase — proves outer wrap is real.
        assert!(decrypt_identity_file(dir.path(), "different-kek", "correct horse battery", &|_| {}).is_err());
        // Empty passphrase on a passphrase-protected file: rejected with a
        // clear message instead of decoding garbage.
        assert!(decrypt_identity_file(dir.path(), "kek-secret-32-bytes", "", &|_| {}).is_err());
    }

    #[test]
    fn legacy_single_wrap_still_unlocks() {
        // Vault set up before the passphrase requirement: identity wrapped
        // with KEK only. Passphrase argument must be ignored.
        let id = x25519::Identity::generate();
        let raw = id.to_string().expose_secret().to_string();
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(CRYPTO_DIR)).unwrap();
        encrypt_identity_file(dir.path(), &raw, "kek-secret", "", &|_| {}).unwrap();

        // Unlock with empty passphrase succeeds.
        let got = decrypt_identity_file(dir.path(), "kek-secret", "", &|_| {}).unwrap();
        assert_eq!(got.trim(), raw.trim());
        // Garbage passphrase is ignored when the file is single-wrap.
        let got2 = decrypt_identity_file(dir.path(), "kek-secret", "whatever", &|_| {}).unwrap();
        assert_eq!(got2.trim(), raw.trim());
    }

    #[test]
    fn set_passphrase_upgrades_legacy_in_place() {
        let id = x25519::Identity::generate();
        let raw = id.to_string().expose_secret().to_string();
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(CRYPTO_DIR)).unwrap();
        // Start as legacy single-wrap.
        encrypt_identity_file(dir.path(), &raw, "kek-x", "", &|_| {}).unwrap();

        // Re-wrap with passphrase using the helper directly (mirrors what
        // `set_passphrase` does, minus the keyring/session plumbing the
        // unit test environment lacks).
        encrypt_identity_file(dir.path(), &raw, "kek-x", "new-passphrase", &|_| {}).unwrap();
        // Now empty passphrase no longer works.
        assert!(decrypt_identity_file(dir.path(), "kek-x", "", &|_| {}).is_err());
        // The new passphrase does.
        let got = decrypt_identity_file(dir.path(), "kek-x", "new-passphrase", &|_| {}).unwrap();
        assert_eq!(got.trim(), raw.trim());
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

    #[test]
    fn ensure_layout_migrates_legacy_filenames() {
        let dir = tempfile::tempdir().unwrap();
        let crypto = dir.path().join(CRYPTO_DIR);
        std::fs::create_dir_all(&crypto).unwrap();
        // Old layout.
        std::fs::write(crypto.join(LEGACY_IDENTITY_FILE), b"dummy").unwrap();
        std::fs::write(crypto.join(LEGACY_PUBKEY_FILE), b"age1xxx\n").unwrap();

        ensure_layout(dir.path()).unwrap();

        assert!(!crypto.join(LEGACY_IDENTITY_FILE).exists());
        assert!(!crypto.join(LEGACY_PUBKEY_FILE).exists());
        assert!(crypto.join(IDENTITY_FILE).exists());
        assert!(crypto.join(PUBKEY_FILE).exists());
        let gitignore = std::fs::read_to_string(crypto.join(GITIGNORE_FILE)).unwrap();
        assert!(gitignore.contains("local-identity.age"));
        assert!(gitignore.contains("local-pubkey.txt"));

        // Re-running is a no-op.
        ensure_layout(dir.path()).unwrap();
        assert!(crypto.join(IDENTITY_FILE).exists());
    }

    #[test]
    fn multi_recipient_can_decrypt_each_other() {
        // Simulate: device 1 sets up + writes a note encrypted to both
        // its own pubkey AND a second device's pubkey. The second
        // device's identity decrypts it.
        let device_a = x25519::Identity::generate();
        let device_b = x25519::Identity::generate();
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(CRYPTO_DIR)).unwrap();
        std::fs::write(
            dir.path().join(CRYPTO_DIR).join(RECIPIENTS_FILE),
            format!("{}\n{}\n", device_a.to_public(), device_b.to_public()),
        )
        .unwrap();

        let ct = encrypt_note(dir.path(), "# shared\n\nmulti-device payload").unwrap();

        // Device B should be able to read it.
        let session_b = Session::default();
        *session_b.inner.lock().unwrap() = Some(Unlocked {
            raw: Zeroizing::new(device_b.to_string().expose_secret().to_string()),
            identity: x25519::Identity::from_str(device_b.to_string().expose_secret()).unwrap(),
        });
        assert_eq!(
            decrypt_note(&session_b, &ct).unwrap(),
            "# shared\n\nmulti-device payload"
        );

        // Device A should also be able to read it.
        let session_a = Session::default();
        *session_a.inner.lock().unwrap() = Some(Unlocked {
            raw: Zeroizing::new(device_a.to_string().expose_secret().to_string()),
            identity: x25519::Identity::from_str(device_a.to_string().expose_secret()).unwrap(),
        });
        assert_eq!(
            decrypt_note(&session_a, &ct).unwrap(),
            "# shared\n\nmulti-device payload"
        );

        // A random third identity (no entry in recipients.txt) cannot.
        let stranger = x25519::Identity::generate();
        let session_stranger = Session::default();
        *session_stranger.inner.lock().unwrap() = Some(Unlocked {
            raw: Zeroizing::new(stranger.to_string().expose_secret().to_string()),
            identity: x25519::Identity::from_str(stranger.to_string().expose_secret()).unwrap(),
        });
        assert!(decrypt_note(&session_stranger, &ct).is_err());
    }

    #[test]
    fn reencrypt_all_rewraps_to_new_recipient_set() {
        // Device A creates a note encrypted only to itself. Then device
        // B's pubkey is added to recipients.txt and reencrypt_all runs
        // with A's session — now B can decrypt the file.
        let device_a = x25519::Identity::generate();
        let device_b = x25519::Identity::generate();
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join(CRYPTO_DIR)).unwrap();
        std::fs::write(
            dir.path().join(CRYPTO_DIR).join(RECIPIENTS_FILE),
            format!("{}\n", device_a.to_public()),
        )
        .unwrap();

        // Initial encrypt → only A can read.
        let ct = encrypt_note(dir.path(), "secret").unwrap();
        let note_path = dir.path().join("note.md.age");
        std::fs::write(&note_path, &ct).unwrap();

        // B alone shouldn't be able to read the file as it currently exists.
        let session_b = Session::default();
        *session_b.inner.lock().unwrap() = Some(Unlocked {
            raw: Zeroizing::new(device_b.to_string().expose_secret().to_string()),
            identity: x25519::Identity::from_str(device_b.to_string().expose_secret()).unwrap(),
        });
        let cipher_before = std::fs::read(&note_path).unwrap();
        assert!(decrypt_note(&session_b, &cipher_before).is_err());

        // Add B as recipient, then reencrypt with A's session.
        add_recipient(dir.path(), &device_b.to_public().to_string()).unwrap();
        let session_a = Session::default();
        *session_a.inner.lock().unwrap() = Some(Unlocked {
            raw: Zeroizing::new(device_a.to_string().expose_secret().to_string()),
            identity: x25519::Identity::from_str(device_a.to_string().expose_secret()).unwrap(),
        });
        let report = reencrypt_all(dir.path(), &session_a).unwrap();
        assert_eq!(report.rewrapped, 1);
        assert_eq!(report.skipped, 0);

        // Now B can decrypt.
        let cipher_after = std::fs::read(&note_path).unwrap();
        assert_eq!(decrypt_note(&session_b, &cipher_after).unwrap(), "secret");
        // And A still can.
        assert_eq!(decrypt_note(&session_a, &cipher_after).unwrap(), "secret");
    }
}
