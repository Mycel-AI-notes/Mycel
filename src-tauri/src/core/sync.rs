use std::path::{Path, PathBuf};

use anyhow::{anyhow, Context, Result};
use chrono::Utc;
use git2::build::{CheckoutBuilder, RepoBuilder};
use git2::{
    AnnotatedCommit, AutotagOption, Cred, FetchOptions, MergeOptions, PushOptions, RemoteCallbacks,
    Repository, Signature, StatusOptions,
};
use serde::{Deserialize, Serialize};

use crate::core::sync_keyring;

const SYNC_CONFIG_REL: &str = ".mycel/sync.json";
const DEFAULT_GITIGNORE: &str = "# Mycel sync\n.DS_Store\nThumbs.db\n*.swp\n*.swo\n";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncConfig {
    pub remote: String,
    pub branch: String,
    #[serde(default = "default_author_name")]
    pub author_name: String,
    #[serde(default = "default_author_email")]
    pub author_email: String,
    #[serde(default = "default_true")]
    pub auto_sync: bool,
    #[serde(default = "default_debounce")]
    pub debounce_ms: u64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_sync_at: Option<String>,
}

fn default_author_name() -> String {
    "Mycel User".into()
}
fn default_author_email() -> String {
    "user@mycel.local".into()
}
fn default_true() -> bool {
    true
}
fn default_debounce() -> u64 {
    30_000
}

#[derive(Debug, Clone, Serialize)]
pub struct SyncStatus {
    pub configured: bool,
    pub has_token: bool,
    pub remote: Option<String>,
    pub branch: Option<String>,
    pub ahead: usize,
    pub behind: usize,
    pub dirty: bool,
    pub conflicts: Vec<String>,
    pub last_sync_at: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum SyncOutcome {
    UpToDate,
    Pulled { commits: usize },
    Pushed { commits: usize },
    PulledAndPushed { pulled: usize, pushed: usize },
    Conflict { files: Vec<String> },
}

pub fn config_path(vault: &Path) -> PathBuf {
    vault.join(SYNC_CONFIG_REL)
}

pub fn read_config(vault: &Path) -> Result<Option<SyncConfig>> {
    let p = config_path(vault);
    if !p.exists() {
        return Ok(None);
    }
    let raw = std::fs::read_to_string(&p).context("read sync.json")?;
    let cfg: SyncConfig = serde_json::from_str(&raw).context("parse sync.json")?;
    Ok(Some(cfg))
}

pub fn write_config(vault: &Path, cfg: &SyncConfig) -> Result<()> {
    let p = config_path(vault);
    if let Some(parent) = p.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let json = serde_json::to_string_pretty(cfg).context("serialize sync.json")?;
    std::fs::write(&p, json).context("write sync.json")?;
    Ok(())
}

/// Strip credentials from a URL so it can be safely logged.
pub fn redact_url(url: &str) -> String {
    if let Some(scheme_end) = url.find("://") {
        let (scheme, rest) = url.split_at(scheme_end + 3);
        if let Some(at) = rest.find('@') {
            return format!("{}***@{}", scheme, &rest[at + 1..]);
        }
    }
    url.to_string()
}

fn make_callbacks<'a>(token: Option<&'a str>) -> RemoteCallbacks<'a> {
    let mut cb = RemoteCallbacks::new();
    if let Some(t) = token {
        cb.credentials(move |_url, _username_from_url, _allowed| {
            // GitHub HTTPS basic auth with PAT: username is "x-access-token"
            // (any non-empty string works), password is the token itself.
            Cred::userpass_plaintext("x-access-token", t)
        });
    }
    cb
}

fn fetch_options<'a>(token: Option<&'a str>) -> FetchOptions<'a> {
    let mut fo = FetchOptions::new();
    fo.remote_callbacks(make_callbacks(token));
    fo.download_tags(AutotagOption::None);
    fo
}

fn push_options<'a>(token: Option<&'a str>) -> PushOptions<'a> {
    let mut po = PushOptions::new();
    po.remote_callbacks(make_callbacks(token));
    po
}

fn signature(cfg: &SyncConfig) -> Result<Signature<'static>> {
    Signature::now(&cfg.author_name, &cfg.author_email).context("build signature")
}

fn ensure_gitignore(vault: &Path) -> Result<()> {
    let p = vault.join(".gitignore");
    if p.exists() {
        let existing = std::fs::read_to_string(&p).unwrap_or_default();
        if !existing.contains(".DS_Store") {
            let mut merged = existing;
            if !merged.ends_with('\n') {
                merged.push('\n');
            }
            merged.push_str(DEFAULT_GITIGNORE);
            std::fs::write(&p, merged).context("update .gitignore")?;
        }
    } else {
        std::fs::write(&p, DEFAULT_GITIGNORE).context("write .gitignore")?;
    }
    Ok(())
}

fn working_tree_dirty(repo: &Repository) -> Result<bool> {
    let mut opts = StatusOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(true);
    let statuses = repo.statuses(Some(&mut opts))?;
    Ok(!statuses.is_empty())
}

fn stage_and_commit_all(repo: &Repository, cfg: &SyncConfig) -> Result<bool> {
    if !working_tree_dirty(repo)? {
        return Ok(false);
    }
    let mut index = repo.index()?;
    index.add_all(["."].iter(), git2::IndexAddOption::DEFAULT, None)?;
    index.write()?;
    let tree_id = index.write_tree()?;
    let tree = repo.find_tree(tree_id)?;
    let sig = signature(cfg)?;
    let msg = format!("Mycel sync {}", Utc::now().to_rfc3339());

    let parent = match repo.head() {
        Ok(head) => Some(head.peel_to_commit()?),
        Err(_) => None,
    };

    match parent {
        Some(p) => {
            repo.commit(Some("HEAD"), &sig, &sig, &msg, &tree, &[&p])?;
        }
        None => {
            repo.commit(Some("HEAD"), &sig, &sig, &msg, &tree, &[])?;
        }
    }
    Ok(true)
}

fn count_ahead_behind(repo: &Repository, branch: &str) -> Result<(usize, usize)> {
    let local = match repo.refname_to_id(&format!("refs/heads/{}", branch)) {
        Ok(id) => id,
        Err(_) => return Ok((0, 0)),
    };
    let upstream = match repo.refname_to_id(&format!("refs/remotes/origin/{}", branch)) {
        Ok(id) => id,
        Err(_) => return Ok((0, 0)),
    };
    let (ahead, behind) = repo.graph_ahead_behind(local, upstream)?;
    Ok((ahead, behind))
}

fn fetch(repo: &Repository, branch: &str, token: Option<&str>) -> Result<()> {
    let mut remote = repo.find_remote("origin").context("find origin remote")?;
    let refspec = format!("+refs/heads/{0}:refs/remotes/origin/{0}", branch);
    let mut opts = fetch_options(token);
    remote
        .fetch(&[&refspec], Some(&mut opts), None)
        .with_context(|| format!("fetch origin {}", branch))?;
    Ok(())
}

fn list_conflicts(repo: &Repository) -> Result<Vec<String>> {
    let mut out = Vec::new();
    let index = repo.index()?;
    if index.has_conflicts() {
        for conflict in index.conflicts()? {
            let c = conflict?;
            let path = c
                .our
                .as_ref()
                .or(c.their.as_ref())
                .or(c.ancestor.as_ref())
                .map(|e| String::from_utf8_lossy(&e.path).to_string());
            if let Some(p) = path {
                out.push(p);
            }
        }
    }
    Ok(out)
}

/// Merge fetched upstream into current branch. Returns number of commits pulled,
/// or Err with conflicts list embedded as error message variant via SyncOutcome
/// at the call site.
enum MergeResult {
    UpToDate,
    FastForwarded(usize),
    Merged(usize),
    Conflicts(Vec<String>),
}

fn merge_upstream(
    repo: &Repository,
    branch: &str,
    cfg: &SyncConfig,
) -> Result<MergeResult> {
    let upstream_ref = format!("refs/remotes/origin/{}", branch);
    let upstream_oid = match repo.refname_to_id(&upstream_ref) {
        Ok(id) => id,
        Err(_) => return Ok(MergeResult::UpToDate),
    };
    let upstream_commit: AnnotatedCommit = repo.find_annotated_commit(upstream_oid)?;

    let (analysis, _pref) = repo.merge_analysis(&[&upstream_commit])?;

    if analysis.is_up_to_date() {
        return Ok(MergeResult::UpToDate);
    }

    // Count "incoming" commits BEFORE we touch refs or commit a merge —
    // after a merge commit the local branch contains upstream as an
    // ancestor and `behind` collapses to 0, which would make the caller
    // think nothing was pulled.
    let (_, behind_before) = count_ahead_behind(repo, branch).unwrap_or((0, 0));

    let local_branch_ref = format!("refs/heads/{}", branch);

    if analysis.is_unborn() || analysis.is_fast_forward() {
        // Move local branch ref to upstream, then checkout.
        let target = upstream_oid;
        match repo.find_reference(&local_branch_ref) {
            Ok(mut r) => {
                r.set_target(target, "mycel: fast-forward")?;
            }
            Err(_) => {
                repo.reference(&local_branch_ref, target, true, "mycel: create branch")?;
            }
        }
        repo.set_head(&local_branch_ref)?;
        let mut co = CheckoutBuilder::new();
        co.force();
        repo.checkout_head(Some(&mut co))?;
        return Ok(MergeResult::FastForwarded(behind_before));
    }

    // Real merge needed. Default options leave conflicts in the index/working
    // tree with standard merge markers, which is exactly what we want to
    // surface to the user.
    let mut merge_opts = MergeOptions::new();
    let mut co = CheckoutBuilder::new();
    co.allow_conflicts(true);
    repo.merge(&[&upstream_commit], Some(&mut merge_opts), Some(&mut co))?;

    let conflicts = list_conflicts(repo)?;
    if !conflicts.is_empty() {
        // Leave conflict markers in the working tree; abort the merge state so
        // the user can edit files and try again with a clean index.
        // We keep the changes on disk by NOT calling cleanup_state until the
        // user resolves; instead surface conflicts and let them re-sync.
        return Ok(MergeResult::Conflicts(conflicts));
    }

    // Clean merge: write tree, create merge commit.
    let mut index = repo.index()?;
    let tree_id = index.write_tree()?;
    let tree = repo.find_tree(tree_id)?;
    let sig = signature(cfg)?;
    let local_commit = repo.head()?.peel_to_commit()?;
    let upstream_real = repo.find_commit(upstream_oid)?;
    let msg = format!("Mycel merge {}", Utc::now().to_rfc3339());
    repo.commit(
        Some("HEAD"),
        &sig,
        &sig,
        &msg,
        &tree,
        &[&local_commit, &upstream_real],
    )?;
    repo.cleanup_state()?;

    Ok(MergeResult::Merged(behind_before))
}

fn push(repo: &Repository, branch: &str, token: Option<&str>) -> Result<()> {
    let mut remote = repo.find_remote("origin")?;
    let refspec = format!("refs/heads/{0}:refs/heads/{0}", branch);
    let mut opts = push_options(token);
    remote
        .push(&[&refspec], Some(&mut opts))
        .with_context(|| format!("push origin {}", branch))?;
    Ok(())
}

/// Clone a remote repository into `dest`. Creates `dest` if missing.
pub fn clone(remote: &str, dest: &Path, branch: Option<&str>, token: Option<&str>) -> Result<()> {
    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent).ok();
    }
    let mut builder = RepoBuilder::new();
    builder.fetch_options(fetch_options(token));
    if let Some(b) = branch {
        builder.branch(b);
    }
    builder
        .clone(remote, dest)
        .with_context(|| format!("clone {}", redact_url(remote)))?;
    Ok(())
}

/// Initialize a git repo inside an existing vault, add a remote, make the
/// first commit, and push if the remote branch does not yet exist.
pub fn init(
    vault: &Path,
    remote: &str,
    branch: &str,
    cfg: &SyncConfig,
    token: Option<&str>,
) -> Result<()> {
    ensure_gitignore(vault)?;

    let repo = if vault.join(".git").exists() {
        Repository::open(vault)?
    } else {
        Repository::init(vault)?
    };

    // Configure remote (replace if exists).
    if repo.find_remote("origin").is_ok() {
        repo.remote_set_url("origin", remote)?;
    } else {
        repo.remote("origin", remote)?;
    }

    // First commit if needed.
    stage_and_commit_all(&repo, cfg)?;

    // Ensure local branch has the requested name.
    let current_branch = current_branch_name(&repo).unwrap_or_default();
    if current_branch != branch {
        if let Ok(head) = repo.head() {
            let oid = head.peel_to_commit()?.id();
            let local_ref = format!("refs/heads/{}", branch);
            repo.reference(&local_ref, oid, true, "mycel: rename branch")?;
            repo.set_head(&local_ref)?;
        }
    }

    // Try fetch — if remote branch exists, merge it in before push.
    if fetch(&repo, branch, token).is_ok() {
        match merge_upstream(&repo, branch, cfg)? {
            MergeResult::Conflicts(files) => {
                return Err(anyhow!(
                    "Initial sync produced conflicts in: {}. Resolve manually and re-run Sync.",
                    files.join(", ")
                ));
            }
            _ => {}
        }
    }

    push(&repo, branch, token).context("initial push")?;
    Ok(())
}

fn current_branch_name(repo: &Repository) -> Option<String> {
    let head = repo.head().ok()?;
    head.shorthand().map(|s| s.to_string())
}

/// Run a full sync cycle: commit local changes, fetch, merge, push.
pub fn sync(vault: &Path, cfg: &SyncConfig, token: Option<&str>) -> Result<SyncOutcome> {
    let repo = Repository::open(vault).context("open repo")?;

    let local_committed = stage_and_commit_all(&repo, cfg)?;

    fetch(&repo, &cfg.branch, token)?;
    let merge = merge_upstream(&repo, &cfg.branch, cfg)?;

    let pulled = match &merge {
        MergeResult::UpToDate => 0,
        MergeResult::FastForwarded(n) | MergeResult::Merged(n) => *n,
        MergeResult::Conflicts(files) => {
            return Ok(SyncOutcome::Conflict {
                files: files.clone(),
            });
        }
    };

    let (ahead_before, _) = count_ahead_behind(&repo, &cfg.branch).unwrap_or((0, 0));

    // Push, with a single retry on failure: re-fetch+merge then push again to
    // recover from races where another device pushed between our fetch and push.
    let first = push(&repo, &cfg.branch, token);
    if first.is_err() {
        fetch(&repo, &cfg.branch, token)?;
        if let MergeResult::Conflicts(files) = merge_upstream(&repo, &cfg.branch, cfg)? {
            return Ok(SyncOutcome::Conflict { files });
        }
        push(&repo, &cfg.branch, token).context("push origin after retry")?;
    }
    let pushed = if local_committed { ahead_before.max(1) } else { ahead_before };

    let outcome = match (pulled, pushed) {
        (0, 0) => SyncOutcome::UpToDate,
        (p, 0) => SyncOutcome::Pulled { commits: p },
        (0, p) => SyncOutcome::Pushed { commits: p },
        (a, b) => SyncOutcome::PulledAndPushed {
            pulled: a,
            pushed: b,
        },
    };

    // Persist last_sync_at.
    let mut updated = cfg.clone();
    updated.last_sync_at = Some(Utc::now().to_rfc3339());
    write_config(vault, &updated).ok();

    Ok(outcome)
}

pub fn status(vault: &Path) -> Result<SyncStatus> {
    let cfg = read_config(vault)?;
    let has_token = sync_keyring::get_token(vault)?.is_some();

    let mut s = SyncStatus {
        configured: cfg.is_some(),
        has_token,
        remote: None,
        branch: None,
        ahead: 0,
        behind: 0,
        dirty: false,
        conflicts: Vec::new(),
        last_sync_at: None,
    };

    let Some(cfg) = cfg else {
        return Ok(s);
    };
    s.remote = Some(redact_url(&cfg.remote));
    s.branch = Some(cfg.branch.clone());
    s.last_sync_at = cfg.last_sync_at.clone();

    if !vault.join(".git").exists() {
        return Ok(s);
    }
    let repo = Repository::open(vault).context("open repo")?;
    s.dirty = working_tree_dirty(&repo).unwrap_or(false);
    let (ahead, behind) = count_ahead_behind(&repo, &cfg.branch).unwrap_or((0, 0));
    s.ahead = ahead;
    s.behind = behind;
    s.conflicts = list_conflicts(&repo).unwrap_or_default();

    Ok(s)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn redact_strips_userinfo() {
        assert_eq!(
            redact_url("https://user:tok@github.com/o/r.git"),
            "https://***@github.com/o/r.git"
        );
        assert_eq!(
            redact_url("https://github.com/o/r.git"),
            "https://github.com/o/r.git"
        );
        assert_eq!(redact_url("git@github.com:o/r.git"), "git@github.com:o/r.git");
    }

    #[test]
    fn config_round_trip() {
        let dir = tempdir();
        std::fs::create_dir_all(dir.join(".mycel")).unwrap();
        let cfg = SyncConfig {
            remote: "https://github.com/o/r.git".into(),
            branch: "main".into(),
            author_name: "X".into(),
            author_email: "x@y".into(),
            auto_sync: true,
            debounce_ms: 1000,
            last_sync_at: None,
        };
        write_config(&dir, &cfg).unwrap();
        let back = read_config(&dir).unwrap().unwrap();
        assert_eq!(back.remote, cfg.remote);
        assert_eq!(back.branch, cfg.branch);
        std::fs::remove_dir_all(&dir).ok();
    }

    fn tempdir() -> PathBuf {
        let mut p = std::env::temp_dir();
        p.push(format!("mycel-sync-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&p).unwrap();
        p
    }
}
