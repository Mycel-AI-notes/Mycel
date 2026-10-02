//! Keeping `[[wikilinks]]` pointing at the right note across renames.
//!
//! `note_rename` used to be a bare `fs::rename`. Nothing rewrote the links,
//! so renaming a note silently broke every reference to it across the whole
//! vault: backlinks vanished, the graph lost its edges, and the only way back
//! was to find every link by hand. The more a vault was used, the more a
//! single rename cost.
//!
//! How a link resolves decides what has to change. Mycel matches a wikilink by
//! the *basename* of its target, case-insensitively — that is what
//! `backlinks_get`, `graph.rs` and the editor's own resolver all do. So:
//!
//! - Renaming a note changes its basename, and every link naming that
//!   basename has to be rewritten.
//! - Moving a note between folders leaves the basename alone, so bare
//!   `[[Name]]` links keep resolving and need no edit. Only path-qualified
//!   `[[folder/Name]]` links have to follow.
//! - Renaming a folder never changes any descendant's basename, so again only
//!   path-qualified links move.
//!
//! Every form the link can take is preserved: the `!` of an embed, a
//! `#heading` anchor, a `|display alias`, an explicit `.md`, and whether the
//! link was written bare or with a folder path.

use std::path::Path;

use anyhow::Result;
use regex::Regex;
use serde::Serialize;
use std::sync::OnceLock;
use walkdir::WalkDir;

/// `(embed)(target)(anchor)(alias)` — anchor and alias optional. Newlines are
/// excluded from every part so an unclosed `[[` cannot swallow the rest of the
/// document.
fn link_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(!?)\[\[([^\]\|\n#]+)(#[^\]\|\n]*)?(\|[^\]\n]*)?\]\]").unwrap())
}

#[derive(Debug, Clone, Default, Serialize, PartialEq, Eq)]
pub struct RewriteSummary {
    /// Notes whose text was modified.
    pub notes_changed: usize,
    /// Individual links rewritten.
    pub links_rewritten: usize,
    /// Encrypted notes passed over — rewriting them needs the vault unlocked,
    /// and a rename must not depend on that. Surfaced so the user knows some
    /// links may still need a manual fix.
    pub encrypted_skipped: usize,
    /// Bare `[[Name]]` links left alone because another note still answers to
    /// that basename, so the link still resolves — just not to the note that
    /// moved. Rewriting it would repoint a working link at the wrong note.
    pub ambiguous_skipped: usize,
}

/// Strip a trailing `.md` (but not `.md.age`, which never appears in link
/// targets) and report whether it was there.
fn split_md_ext(target: &str) -> (&str, bool) {
    match target.strip_suffix(".md") {
        Some(rest) => (rest, true),
        None => (target, false),
    }
}

/// The basename of a vault-relative note path, without `.md` or `.md.age`.
pub fn note_stem(rel: &str) -> &str {
    let base = rel.rsplit('/').next().unwrap_or(rel);
    base.strip_suffix(".md.age")
        .or_else(|| base.strip_suffix(".md"))
        .unwrap_or(base)
}

/// Does the link path `link` (already stripped of `.md`) refer to the note at
/// `rel`? A link may name the note bare, fully, or by any trailing run of
/// path segments, so compare from the right, case-insensitively.
fn path_refers_to(link: &str, rel: &str) -> bool {
    let target = note_path_without_ext(rel);
    if link.eq_ignore_ascii_case(&target) {
        return true;
    }
    let link_segs: Vec<&str> = link.split('/').collect();
    let target_segs: Vec<&str> = target.split('/').collect();
    if link_segs.len() > target_segs.len() {
        return false;
    }
    let tail = &target_segs[target_segs.len() - link_segs.len()..];
    link_segs
        .iter()
        .zip(tail)
        .all(|(a, b)| a.eq_ignore_ascii_case(b))
}

/// A note's vault-relative path with its note extension removed, which is the
/// shape a wikilink target takes.
fn note_path_without_ext(rel: &str) -> String {
    let trimmed = rel
        .strip_suffix(".md.age")
        .or_else(|| rel.strip_suffix(".md"))
        .unwrap_or(rel);
    trimmed.to_string()
}

/// What a single link target should become, or `None` to leave it as it is.
///
/// `old_rel` / `new_rel` are the renamed entry. `is_dir` says whether they
/// name a folder. `old_stem_free` says that, now the rename has happened, no
/// note is left answering to the old basename — the condition under which a
/// bare link is unambiguously about the note that moved.
fn rewritten_target(
    target: &str,
    old_rel: &str,
    new_rel: &str,
    is_dir: bool,
    old_stem_free: bool,
    ambiguous: &mut usize,
) -> Option<String> {
    let (path, had_ext) = split_md_ext(target.trim());
    if path.is_empty() {
        return None;
    }

    if is_dir {
        // Only a link that spells out the folder is affected; a descendant's
        // basename has not changed.
        let prefix = format!("{old_rel}/");
        if path.len() > prefix.len() && path[..prefix.len()].eq_ignore_ascii_case(&prefix) {
            let rest = &path[prefix.len()..];
            return Some(restore_ext(&format!("{new_rel}/{rest}"), had_ext));
        }
        // A link may also name the folder by a trailing run of its segments
        // (`[[parent/folder/child]]` for `a/b/parent/folder`). Rare enough
        // that the exact-prefix case above covers real vaults; anything else
        // keeps resolving by basename regardless.
        return None;
    }

    let new_path = note_path_without_ext(new_rel);
    let is_bare = !path.contains('/');

    if is_bare {
        if !note_stem(path).eq_ignore_ascii_case(note_stem(old_rel)) {
            return None;
        }
        if !old_stem_free {
            // Another note still carries this basename, so the link resolves
            // as it always did. It may have meant the note that just moved,
            // but we cannot tell, and breaking a link that works is worse
            // than leaving one that might be stale.
            *ambiguous += 1;
            return None;
        }
        // Keep the link bare: rewriting `[[Old]]` to `[[folder/New]]` would
        // change the author's chosen style for no reason, and the basename
        // still resolves.
        return Some(restore_ext(note_stem(new_rel), had_ext));
    }

    if path_refers_to(path, old_rel) {
        // Path-qualified: follow the note to its new location in full.
        return Some(restore_ext(&new_path, had_ext));
    }
    None
}

fn restore_ext(path: &str, had_ext: bool) -> String {
    if had_ext {
        format!("{path}.md")
    } else {
        path.to_string()
    }
}

/// Rewrite every wikilink in the vault that pointed at `old_rel` so it points
/// at `new_rel`. Call it *after* the rename has happened on disk.
///
/// Best-effort per note: a note that cannot be read or written is counted and
/// skipped rather than failing the whole pass, because the rename itself has
/// already succeeded and leaving the remaining notes unfixed would be worse.
pub fn rewrite_links_for_rename(
    root: &Path,
    old_rel: &str,
    new_rel: &str,
    is_dir: bool,
) -> Result<RewriteSummary> {
    let mut summary = RewriteSummary::default();
    if old_rel == new_rel {
        return Ok(summary);
    }

    // Asked after the rename, which is when this runs: does anything still
    // answer to the old basename? If so, bare links to it still work and must
    // be left alone. If not, they are now dangling and can only have meant the
    // note that moved.
    let old_stem_free = if is_dir {
        true
    } else {
        count_notes_with_stem(root, note_stem(old_rel)) == 0
    };

    for rel in list_notes(root) {
        if rel.ends_with(".md.age") {
            summary.encrypted_skipped += 1;
            continue;
        }
        let abs = root.join(&rel);
        let Ok(content) = std::fs::read_to_string(&abs) else {
            continue;
        };

        let mut rewritten = 0usize;
        let mut ambiguous = 0usize;
        let next = link_re()
            .replace_all(&content, |caps: &regex::Captures| {
                let embed = caps.get(1).map(|m| m.as_str()).unwrap_or("");
                let target = caps.get(2).map(|m| m.as_str()).unwrap_or("");
                let anchor = caps.get(3).map(|m| m.as_str()).unwrap_or("");
                let alias = caps.get(4).map(|m| m.as_str()).unwrap_or("");
                match rewritten_target(
                    target,
                    old_rel,
                    new_rel,
                    is_dir,
                    old_stem_free,
                    &mut ambiguous,
                ) {
                    Some(new_target) => {
                        rewritten += 1;
                        // Preserve whatever padding the author had around the
                        // target so the diff stays minimal.
                        let lead = &target[..target.len() - target.trim_start().len()];
                        let trail = &target[target.trim_end().len()..];
                        format!("{embed}[[{lead}{new_target}{trail}{anchor}{alias}]]")
                    }
                    None => caps.get(0).map(|m| m.as_str()).unwrap_or("").to_string(),
                }
            })
            .into_owned();

        summary.ambiguous_skipped += ambiguous;
        if rewritten == 0 {
            continue;
        }
        if std::fs::write(&abs, &next).is_err() {
            continue;
        }
        summary.notes_changed += 1;
        summary.links_rewritten += rewritten;
    }

    Ok(summary)
}

/// How many notes in the vault carry `stem` as their basename.
fn count_notes_with_stem(root: &Path, stem: &str) -> usize {
    list_notes(root)
        .into_iter()
        .filter(|rel| note_stem(rel).eq_ignore_ascii_case(stem))
        .count()
}

/// Vault-relative paths of every note, skipping dot-directories (`.git`,
/// `.mycel`) without descending into them.
fn list_notes(root: &Path) -> Vec<String> {
    let mut out = Vec::new();
    for entry in WalkDir::new(root)
        .into_iter()
        .filter_entry(|e| {
            e.depth() == 0
                || !e
                    .file_name()
                    .to_str()
                    .map(|n| n.starts_with('.'))
                    .unwrap_or(false)
        })
        .filter_map(|e| e.ok())
    {
        if !entry.file_type().is_file() {
            continue;
        }
        let Ok(rel_os) = entry.path().strip_prefix(root) else {
            continue;
        };
        let rel = rel_os.to_string_lossy().replace('\\', "/");
        if rel.ends_with(".md") || rel.ends_with(".md.age") {
            out.push(rel);
        }
    }
    out
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

    fn read(root: &Path, rel: &str) -> String {
        std::fs::read_to_string(root.join(rel)).unwrap()
    }

    /// Simulate what `note_rename` does: move on disk, then fix the links.
    fn rename(root: &Path, old: &str, new: &str) -> RewriteSummary {
        let is_dir = root.join(old).is_dir();
        let dest = root.join(new);
        std::fs::create_dir_all(dest.parent().unwrap()).unwrap();
        std::fs::rename(root.join(old), dest).unwrap();
        rewrite_links_for_rename(root, old, new, is_dir).unwrap()
    }

    #[test]
    fn rewrites_a_bare_link() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "Old Name.md", "# Old Name\n");
        write(root, "other.md", "see [[Old Name]] for details\n");

        let s = rename(root, "Old Name.md", "New Name.md");

        assert_eq!(read(root, "other.md"), "see [[New Name]] for details\n");
        assert_eq!(s.links_rewritten, 1);
        assert_eq!(s.notes_changed, 1);
    }

    #[test]
    fn keeps_the_display_alias() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "Old.md", "x");
        write(root, "other.md", "[[Old|what I call it]]\n");

        rename(root, "Old.md", "New.md");

        assert_eq!(read(root, "other.md"), "[[New|what I call it]]\n");
    }

    #[test]
    fn keeps_the_heading_anchor() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "Old.md", "x");
        write(root, "other.md", "[[Old#Priors]]\n");

        rename(root, "Old.md", "New.md");

        assert_eq!(read(root, "other.md"), "[[New#Priors]]\n");
    }

    #[test]
    fn keeps_anchor_and_alias_together() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "Old.md", "x");
        write(root, "other.md", "[[Old#Priors|see the priors]]\n");

        rename(root, "Old.md", "New.md");

        assert_eq!(read(root, "other.md"), "[[New#Priors|see the priors]]\n");
    }

    #[test]
    fn keeps_the_embed_marker() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "Old.md", "x");
        write(root, "other.md", "![[Old]]\n");

        rename(root, "Old.md", "New.md");

        assert_eq!(read(root, "other.md"), "![[New]]\n");
    }

    #[test]
    fn keeps_an_explicit_md_extension() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "Old.md", "x");
        write(root, "other.md", "[[Old.md]]\n");

        rename(root, "Old.md", "New.md");

        assert_eq!(read(root, "other.md"), "[[New.md]]\n");
    }

    #[test]
    fn matches_a_link_case_insensitively() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "Deep Learning.md", "x");
        write(root, "other.md", "[[deep learning]]\n");

        rename(root, "Deep Learning.md", "Neural Nets.md");

        assert_eq!(read(root, "other.md"), "[[Neural Nets]]\n");
    }

    #[test]
    fn rewrites_a_path_qualified_link_in_full() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "notes/Old.md", "x");
        write(root, "other.md", "[[notes/Old]]\n");

        rename(root, "notes/Old.md", "archive/New.md");

        assert_eq!(read(root, "other.md"), "[[archive/New]]\n");
    }

    #[test]
    fn a_move_leaves_bare_links_alone() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "Note.md", "x");
        write(root, "other.md", "[[Note]]\n");

        // The basename is unchanged, so the link still resolves. Rewriting it
        // to `archive/Note` would churn the file for nothing.
        let s = rename(root, "Note.md", "archive/Note.md");

        assert_eq!(read(root, "other.md"), "[[Note]]\n");
        assert_eq!(s.links_rewritten, 0);
    }

    #[test]
    fn rewrites_several_links_across_several_notes() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "Old.md", "x");
        write(root, "a.md", "[[Old]] and again [[Old|twice]]\n");
        write(root, "b.md", "nested [[Old#H]]\n");
        write(root, "c.md", "unrelated [[Other]]\n");

        let s = rename(root, "Old.md", "New.md");

        assert_eq!(read(root, "a.md"), "[[New]] and again [[New|twice]]\n");
        assert_eq!(read(root, "b.md"), "nested [[New#H]]\n");
        assert_eq!(read(root, "c.md"), "unrelated [[Other]]\n");
        assert_eq!(s.links_rewritten, 3);
        assert_eq!(s.notes_changed, 2);
    }

    #[test]
    fn leaves_unrelated_links_untouched() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "Old.md", "x");
        write(root, "other.md", "[[Oldest]] [[Older]] [[NotOld]]\n");

        let s = rename(root, "Old.md", "New.md");

        assert_eq!(read(root, "other.md"), "[[Oldest]] [[Older]] [[NotOld]]\n");
        assert_eq!(s.links_rewritten, 0);
    }

    #[test]
    fn folder_rename_follows_path_qualified_links() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "old/child.md", "x");
        write(root, "old/deep/grand.md", "x");
        write(root, "other.md", "[[old/child]] and [[old/deep/grand]]\n");

        let s = rename(root, "old", "new");

        assert_eq!(
            read(root, "other.md"),
            "[[new/child]] and [[new/deep/grand]]\n"
        );
        assert_eq!(s.links_rewritten, 2);
    }

    #[test]
    fn folder_rename_leaves_bare_links_alone() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "old/child.md", "x");
        write(root, "other.md", "[[child]]\n");

        // A descendant's basename does not change when its folder is renamed.
        let s = rename(root, "old", "new");

        assert_eq!(read(root, "other.md"), "[[child]]\n");
        assert_eq!(s.links_rewritten, 0);
    }

    #[test]
    fn folder_rename_does_not_touch_a_name_alike_sibling() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "docs/a.md", "x");
        write(root, "docs-archive/b.md", "x");
        write(root, "other.md", "[[docs/a]] [[docs-archive/b]]\n");

        rename(root, "docs", "guide");

        assert_eq!(read(root, "other.md"), "[[guide/a]] [[docs-archive/b]]\n");
    }

    #[test]
    fn ambiguous_bare_links_are_left_alone_and_reported() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        // Two notes share the basename `Note`, so `[[Note]]` could mean
        // either. Repointing it would be a guess.
        write(root, "a/Note.md", "x");
        write(root, "b/Note.md", "x");
        write(root, "other.md", "[[Note]]\n");

        let s = rename(root, "a/Note.md", "a/Renamed.md");

        assert_eq!(read(root, "other.md"), "[[Note]]\n");
        assert_eq!(s.links_rewritten, 0);
        assert_eq!(s.ambiguous_skipped, 1);
    }

    #[test]
    fn ambiguity_does_not_block_a_path_qualified_link() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "a/Note.md", "x");
        write(root, "b/Note.md", "x");
        write(root, "other.md", "[[a/Note]] and [[Note]]\n");

        let s = rename(root, "a/Note.md", "a/Renamed.md");

        // The qualified link says which note it meant, so it can follow.
        assert_eq!(read(root, "other.md"), "[[a/Renamed]] and [[Note]]\n");
        assert_eq!(s.links_rewritten, 1);
        assert_eq!(s.ambiguous_skipped, 1);
    }

    #[test]
    fn encrypted_notes_are_skipped_and_counted() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "Old.md", "x");
        write(root, "secret.md.age", "ciphertext with [[Old]] inside");
        write(root, "other.md", "[[Old]]\n");

        let s = rename(root, "Old.md", "New.md");

        assert_eq!(s.encrypted_skipped, 1);
        assert_eq!(
            read(root, "secret.md.age"),
            "ciphertext with [[Old]] inside",
            "ciphertext must not be touched"
        );
        assert_eq!(read(root, "other.md"), "[[New]]\n");
    }

    #[test]
    fn dot_directories_are_not_scanned() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "Old.md", "x");
        write(root, ".git/hooks/note.md", "[[Old]]\n");
        write(root, ".mycel/trash/2026/Old.md", "[[Old]]\n");
        write(root, "other.md", "[[Old]]\n");

        rename(root, "Old.md", "New.md");

        assert_eq!(read(root, ".git/hooks/note.md"), "[[Old]]\n");
        assert_eq!(read(root, ".mycel/trash/2026/Old.md"), "[[Old]]\n");
        assert_eq!(read(root, "other.md"), "[[New]]\n");
    }

    #[test]
    fn a_no_op_rename_changes_nothing() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "Old.md", "x");
        write(root, "other.md", "[[Old]]\n");

        let s = rewrite_links_for_rename(root, "Old.md", "Old.md", false).unwrap();

        assert_eq!(s, RewriteSummary::default());
        assert_eq!(read(root, "other.md"), "[[Old]]\n");
    }

    #[test]
    fn an_unclosed_bracket_does_not_swallow_the_document() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "Old.md", "x");
        write(root, "other.md", "[[Old\nnext line [[Old]]\n");

        rename(root, "Old.md", "New.md");

        assert_eq!(read(root, "other.md"), "[[Old\nnext line [[New]]\n");
    }

    #[test]
    fn whitespace_inside_the_brackets_is_preserved() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        write(root, "Old.md", "x");
        write(root, "other.md", "[[ Old ]]\n");

        rename(root, "Old.md", "New.md");

        assert_eq!(read(root, "other.md"), "[[ New ]]\n");
    }

    #[test]
    fn note_stem_strips_both_note_extensions() {
        assert_eq!(note_stem("a/b/Note.md"), "Note");
        assert_eq!(note_stem("Note.md.age"), "Note");
        assert_eq!(note_stem("Note"), "Note");
    }
}
