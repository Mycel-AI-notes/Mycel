//! Quick-note filing: shared logic behind the `quick_note_filing` detector
//! and the `quick_note_merge` command.
//!
//! See `docs/specs/quick-note-filing.md`. The merge appends the quick note's
//! body to the target as a dated section with a provenance line, then either
//! deletes the source or marks it with a `filed_to:` frontmatter key so the
//! detector never suggests it again. Everything here is plain-text file
//! surgery — encrypted notes (`.md.age`) are rejected up front.

use std::path::Path;

use anyhow::{bail, Context, Result};

use super::vault::{auto_heading, is_safe_rel_path, QUICK_NOTES_DIR};

/// True when `rel` lives under the quick-capture folder.
pub fn is_quick_path(rel: &str) -> bool {
    rel.starts_with(&format!("{QUICK_NOTES_DIR}/"))
}

/// Split `raw` into `(frontmatter_inner, body)` when it starts with a
/// terminated YAML frontmatter block. `frontmatter_inner` is everything
/// between the two `---` delimiter lines (trailing newline included).
/// Returns `None` for no block — and for an *unterminated* block, so
/// callers treat the whole file as body rather than silently swallowing
/// everything after the first `---`.
fn frontmatter_parts(raw: &str) -> Option<(&str, &str)> {
    let rest = raw.strip_prefix("---\n").or_else(|| raw.strip_prefix("---\r\n"))?;
    let mut offset = 0usize;
    for line in rest.split_inclusive('\n') {
        if line.trim_end() == "---" {
            return Some((&rest[..offset], &rest[offset + line.len()..]));
        }
        offset += line.len();
    }
    None
}

/// Body of `raw` with an optional YAML frontmatter block removed.
pub fn strip_frontmatter(raw: &str) -> &str {
    match frontmatter_parts(raw) {
        Some((_, body)) => body,
        None => raw,
    }
}

/// True when the frontmatter block contains a `filed_to:` key — the marker
/// `merge` leaves on a kept source so the detector skips it forever.
pub fn has_filed_marker(raw: &str) -> bool {
    let Some((inner, _)) = frontmatter_parts(raw) else {
        return false;
    };
    inner
        .lines()
        .any(|line| line.trim_start().starts_with("filed_to:"))
}

/// The quick note's meaningful content: frontmatter stripped, and the
/// auto-generated `# <stem>` heading that `note_create` seeds dropped.
/// A freshly captured note the user never typed into comes back empty.
pub fn note_body(raw: &str, rel_path: &str) -> String {
    let body = strip_frontmatter(raw);
    let stem = Path::new(rel_path)
        .file_stem()
        .and_then(|s| s.to_str())
        .unwrap_or("");
    let auto_heading = auto_heading(stem);
    let trimmed = body.trim_start();
    if let Some(rest) = trimmed.strip_prefix(&auto_heading) {
        if rest.is_empty() || rest.starts_with('\n') || rest.starts_with("\r\n") {
            return rest.trim().to_string();
        }
    }
    body.trim().to_string()
}

/// Make `line` safe and pleasant as a note filename: markdown noise and
/// filename-hostile characters stripped, whitespace collapsed, truncated to
/// 60 chars on a char boundary, no trailing punctuation. May come back
/// empty when the input had nothing usable.
pub fn sanitize_for_filename(line: &str) -> String {
    let mut cleaned = String::with_capacity(line.len());
    for c in line.chars() {
        match c {
            // Markdown noise: drop entirely.
            '[' | ']' | '`' | '*' | '_' | '|' => {}
            // Unsafe in filenames on at least one supported OS.
            '/' | '\\' | ':' | '?' | '"' | '<' | '>' => cleaned.push(' '),
            _ => cleaned.push(c),
        }
    }
    let cleaned = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");
    let truncated: String = cleaned.chars().take(60).collect();
    truncated.trim_end_matches(['.', ' ', ',']).to_string()
}

/// Title suggestion for a still-auto-named quick note: the first content
/// line, sanitized. `None` when the body has no usable line.
pub fn suggest_title(body: &str) -> Option<String> {
    let line = body.lines().find(|l| !l.trim().is_empty())?;
    let line = line.trim().trim_start_matches(['#', '>', '-', '*', ' ']).trim();
    let title = sanitize_for_filename(line);
    if title.is_empty() {
        None
    } else {
        Some(title)
    }
}

/// Capture time from the canonical quick-note path
/// `quick/YYYY-MM-DD/HH-MM-SS[-n].md` → `"YYYY-MM-DD HH:MM"`. Returns `None`
/// for anything that doesn't match — callers fall back to the file's mtime.
pub fn capture_timestamp(rel_path: &str) -> Option<String> {
    let mut parts = rel_path.rsplit('/');
    let file = parts.next()?;
    let day = parts.next()?;

    let day_ok = day.len() == 10
        && day.bytes().enumerate().all(|(i, b)| match i {
            4 | 7 => b == b'-',
            _ => b.is_ascii_digit(),
        });
    if !day_ok {
        return None;
    }

    let stem = file.strip_suffix(".md")?;
    let hm = stem.get(0..8)?; // HH-MM-SS, ignore any -n suffix
    let hm_ok = hm
        .bytes()
        .enumerate()
        .all(|(i, b)| match i {
            2 | 5 => b == b'-',
            _ => b.is_ascii_digit(),
        });
    if !hm_ok {
        return None;
    }
    Some(format!("{} {}:{}", day, &hm[0..2], &hm[3..5]))
}

/// The section appended to the target note. Heading carries the capture
/// time (the one piece of metadata a quick note genuinely has); the trailing
/// line is the provenance trail.
pub fn build_section(timestamp: &str, body: &str, source_rel: &str) -> String {
    format!(
        "\n\n## Quick note · {timestamp}\n\n{body}\n\n*(filed from `{source_rel}`)*\n"
    )
}

/// Insert `filed_to: <target>` into the source's frontmatter (creating the
/// block when absent) so a kept original is never suggested again.
pub fn mark_filed(raw: &str, target_rel: &str) -> String {
    match frontmatter_parts(raw) {
        Some((inner, body)) => {
            format!("---\n{inner}filed_to: {target_rel}\n---\n{body}")
        }
        None => format!("---\nfiled_to: {target_rel}\n---\n\n{raw}"),
    }
}

/// Perform the merge on disk. Each step runs only if the previous one
/// succeeded; the source is never touched before the target write landed.
///
/// Returns the timestamp label used in the appended heading (the frontend
/// shows it in the success toast).
pub fn merge(
    vault_root: &Path,
    source_rel: &str,
    target_rel: &str,
    delete_source: bool,
) -> Result<String> {
    if !is_safe_rel_path(source_rel) || !is_safe_rel_path(target_rel) {
        bail!("Invalid note path");
    }
    if source_rel == target_rel {
        bail!("Source and target are the same note");
    }
    if !is_quick_path(source_rel) {
        bail!("Only notes under {QUICK_NOTES_DIR}/ can be filed");
    }
    if !source_rel.ends_with(".md") || !target_rel.ends_with(".md") {
        bail!("Quick-note filing only works with plain .md notes");
    }

    let source_abs = vault_root.join(source_rel);
    let target_abs = vault_root.join(target_rel);

    let raw = std::fs::read_to_string(&source_abs)
        .with_context(|| format!("Failed to read {source_rel}"))?;
    let body = note_body(&raw, source_rel);
    if body.is_empty() {
        bail!("The quick note is empty — nothing to file");
    }

    let timestamp = capture_timestamp(source_rel)
        .or_else(|| {
            std::fs::metadata(&source_abs)
                .and_then(|m| m.modified())
                .ok()
                .map(|t| {
                    chrono::DateTime::<chrono::Local>::from(t)
                        .format("%Y-%m-%d %H:%M")
                        .to_string()
                })
        })
        .unwrap_or_else(|| "unknown time".to_string());

    let target = std::fs::read_to_string(&target_abs)
        .with_context(|| format!("Failed to read {target_rel}"))?;
    let merged = format!(
        "{}{}",
        target.trim_end(),
        build_section(&timestamp, &body, source_rel)
    );
    std::fs::write(&target_abs, &merged)
        .with_context(|| format!("Failed to write {target_rel}"))?;

    if delete_source {
        std::fs::remove_file(&source_abs)
            .with_context(|| format!("Failed to delete {source_rel}"))?;
    } else {
        let kept = mark_filed(&raw, target_rel);
        std::fs::write(&source_abs, kept)
            .with_context(|| format!("Failed to update {source_rel}"))?;
    }

    Ok(timestamp)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write(root: &Path, rel: &str, content: &str) {
        let abs = root.join(rel);
        std::fs::create_dir_all(abs.parent().unwrap()).unwrap();
        std::fs::write(abs, content).unwrap();
    }

    fn read(root: &Path, rel: &str) -> String {
        std::fs::read_to_string(root.join(rel)).unwrap()
    }

    #[test]
    fn strip_frontmatter_variants() {
        assert_eq!(strip_frontmatter("no fm"), "no fm");
        assert_eq!(strip_frontmatter("---\na: 1\n---\nbody"), "body");
        assert_eq!(strip_frontmatter("---\na: 1\n---\n"), "");
        // Unterminated block: keep the whole text.
        assert_eq!(strip_frontmatter("---\na: 1\nbody"), "---\na: 1\nbody");
    }

    #[test]
    fn filed_marker_detection() {
        assert!(!has_filed_marker("plain note"));
        assert!(!has_filed_marker("---\ntitle: x\n---\nbody"));
        assert!(has_filed_marker("---\nfiled_to: a.md\n---\nbody"));
        // Key mentioned in the body, not the frontmatter — not a marker.
        assert!(!has_filed_marker("---\nt: x\n---\nfiled_to: a.md"));
    }

    #[test]
    fn note_body_drops_auto_heading() {
        let raw = "# 14-32-08\n\ncall the nursery\n";
        assert_eq!(note_body(raw, "quick/2026-06-09/14-32-08.md"), "call the nursery");
        // A heading the user wrote stays.
        let custom = "# My idea\n\ndetails\n";
        assert_eq!(
            note_body(custom, "quick/2026-06-09/14-32-08.md"),
            "# My idea\n\ndetails"
        );
        // Untouched fresh capture → empty.
        assert_eq!(note_body("# 14-32-08\n\n", "quick/2026-06-09/14-32-08.md"), "");
    }

    #[test]
    fn suggest_title_cleans_first_line() {
        assert_eq!(
            suggest_title("- [ ] call the **nursery** about [[saplings]]\nmore"),
            Some("call the nursery about saplings".to_string())
        );
        assert_eq!(suggest_title("idea: split sync/crypto?"), Some("idea split sync crypto".to_string()));
        assert_eq!(suggest_title("\n\n   \n"), None);
        // Truncated on a char boundary, no trailing punctuation.
        let long = "x".repeat(80);
        assert_eq!(suggest_title(&long).unwrap().chars().count(), 60);
    }

    #[test]
    fn capture_timestamp_parses_canonical_paths() {
        assert_eq!(
            capture_timestamp("quick/2026-06-09/14-32-08.md").as_deref(),
            Some("2026-06-09 14:32")
        );
        // Collision suffix is ignored.
        assert_eq!(
            capture_timestamp("quick/2026-06-09/14-32-08-1.md").as_deref(),
            Some("2026-06-09 14:32")
        );
        assert_eq!(capture_timestamp("notes/other.md"), None);
        assert_eq!(capture_timestamp("quick/not-a-date/14-32-08.md"), None);
    }

    #[test]
    fn mark_filed_inserts_into_existing_frontmatter() {
        let got = mark_filed("---\ntitle: x\n---\nbody", "a.md");
        assert_eq!(got, "---\ntitle: x\nfiled_to: a.md\n---\nbody");
        let got = mark_filed("plain body", "a.md");
        assert_eq!(got, "---\nfiled_to: a.md\n---\n\nplain body");
    }

    #[test]
    fn merge_appends_section_and_deletes_source() {
        let dir = TempDir::new().unwrap();
        write(dir.path(), "quick/2026-06-09/14-32-08.md", "# 14-32-08\n\nplant the apple tree\n");
        write(dir.path(), "garden.md", "# Garden\n\nexisting\n");

        let ts = merge(dir.path(), "quick/2026-06-09/14-32-08.md", "garden.md", true).unwrap();
        assert_eq!(ts, "2026-06-09 14:32");

        let target = read(dir.path(), "garden.md");
        assert!(target.starts_with("# Garden\n\nexisting\n\n## Quick note · 2026-06-09 14:32\n"));
        assert!(target.contains("plant the apple tree"));
        assert!(target.contains("*(filed from `quick/2026-06-09/14-32-08.md`)*"));
        assert!(!dir.path().join("quick/2026-06-09/14-32-08.md").exists());
    }

    #[test]
    fn merge_keeps_source_with_marker_when_asked() {
        let dir = TempDir::new().unwrap();
        write(dir.path(), "quick/2026-06-09/14-32-08.md", "a thought\n");
        write(dir.path(), "garden.md", "# Garden\n");

        merge(dir.path(), "quick/2026-06-09/14-32-08.md", "garden.md", false).unwrap();

        let source = read(dir.path(), "quick/2026-06-09/14-32-08.md");
        assert!(has_filed_marker(&source));
        assert!(source.contains("a thought"));
    }

    #[test]
    fn merge_refuses_bad_inputs() {
        let dir = TempDir::new().unwrap();
        write(dir.path(), "quick/2026-06-09/a.md", "text\n");
        write(dir.path(), "quick/2026-06-09/empty.md", "# empty\n\n");
        write(dir.path(), "t.md", "# T\n");

        // Source outside quick/.
        assert!(merge(dir.path(), "t.md", "quick/2026-06-09/a.md", true).is_err());
        // Path traversal.
        assert!(merge(dir.path(), "quick/../../etc/x.md", "t.md", true).is_err());
        // Encrypted extension.
        assert!(merge(dir.path(), "quick/2026-06-09/a.md", "t.md.age", true).is_err());
        // Same note.
        assert!(merge(dir.path(), "quick/2026-06-09/a.md", "quick/2026-06-09/a.md", true).is_err());
        // Empty body (auto heading only).
        assert!(merge(dir.path(), "quick/2026-06-09/empty.md", "t.md", true).is_err());
        // Missing target.
        assert!(merge(dir.path(), "quick/2026-06-09/a.md", "missing.md", true).is_err());
        // Nothing was harmed.
        assert_eq!(read(dir.path(), "t.md"), "# T\n");
        assert!(dir.path().join("quick/2026-06-09/a.md").exists());
    }
}
