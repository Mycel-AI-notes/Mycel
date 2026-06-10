//! Local JSONL trace of quick-filing suggestions and outcomes.
//!
//! Every `quick_note_suggest` call appends a `"suggest"` record (the note,
//! the embedding candidates, the LLM's verdict, what the bar showed) and
//! every user decision appends an `"outcome"` record. The point is a
//! dataset: line up suggestions against what the user actually did and
//! you can tune the prompt, the thresholds, or a future fine-tune without
//! guessing.
//!
//! Lives at `.mycel/ai/quick_filing_log.jsonl` — next to the SQLite index,
//! local-only by the same convention (the vault layout docs tell users to
//! gitignore `.mycel/`). Note bodies are stored as-is, truncated; this is
//! the user's own disk and their own notes.
//!
//! Append is best-effort by design: a full disk or a permissions hiccup
//! must never fail the suggestion or the merge it was logging.

use std::io::Write;
use std::path::{Path, PathBuf};

pub const LOG_FILE: &str = "quick_filing_log.jsonl";

fn log_path(vault_root: &Path) -> PathBuf {
    vault_root.join(".mycel").join("ai").join(LOG_FILE)
}

/// Append one record as a single JSONL line. Errors are logged and dropped.
pub fn append(vault_root: &Path, record: &serde_json::Value) {
    let path = log_path(vault_root);
    let write = || -> std::io::Result<()> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let mut f = std::fs::OpenOptions::new()
            .create(true)
            .append(true)
            .open(&path)?;
        writeln!(f, "{record}")
    };
    if let Err(e) = write() {
        eprintln!("quick-filing log append failed: {e}");
    }
}

/// Shorthand for an outcome record (a user decision on a suggestion).
pub fn outcome(vault_root: &Path, action: &str, source: &str, target: Option<&str>) {
    append(
        vault_root,
        &serde_json::json!({
            "ts": chrono::Utc::now().to_rfc3339(),
            "event": "outcome",
            "action": action,
            "source": source,
            "target": target,
        }),
    );
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn appends_parseable_jsonl_lines() {
        let dir = TempDir::new().unwrap();
        append(dir.path(), &serde_json::json!({"event": "suggest", "note": "a.md"}));
        outcome(dir.path(), "merge", "quick/x.md", Some("garden.md"));

        let raw = std::fs::read_to_string(log_path(dir.path())).unwrap();
        let lines: Vec<&str> = raw.lines().collect();
        assert_eq!(lines.len(), 2);
        let first: serde_json::Value = serde_json::from_str(lines[0]).unwrap();
        assert_eq!(first["event"], "suggest");
        let second: serde_json::Value = serde_json::from_str(lines[1]).unwrap();
        assert_eq!(second["action"], "merge");
        assert_eq!(second["target"], "garden.md");
    }
}
