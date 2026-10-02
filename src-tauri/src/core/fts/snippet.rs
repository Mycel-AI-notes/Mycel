//! Turn FTS5 `highlight()` output into short, line-addressed snippets.
//!
//! FTS5's own `snippet()` returns one fragment per note with no position, so
//! it can neither show "three places this note mentions it" nor tell the
//! editor which line to jump to. Instead we ask for the whole body with every
//! hit wrapped in sentinel characters, then cut it ourselves: each line that
//! holds a hit becomes a snippet, trimmed to a window around its first hit,
//! and carries its line number in the file.

use serde::Serialize;

/// Opens a highlighted span. Private-use code points: they never occur in
/// real notes (indexing strips them just in case), survive JSON untouched,
/// and are trivially split on by the frontend.
pub const HL_START: char = '\u{E000}';
/// Closes a highlighted span.
pub const HL_END: char = '\u{E001}';

/// Characters kept before the first hit on a line.
const LEAD: usize = 40;
/// Maximum characters in one snippet, markers excluded.
const WIDTH: usize = 160;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Snippet {
    /// 1-based line number in the file (frontmatter included), so the editor
    /// can jump straight to it.
    pub line: usize,
    /// Line text with hits wrapped in [`HL_START`] / [`HL_END`]. Markers are
    /// always balanced, even when the window cuts through a hit.
    pub text: String,
}

/// Up to `max` snippets from `highlighted` (a body with hits marked).
/// `body_line` is the 0-based line of the file the body starts on — the
/// frontmatter's height — so returned line numbers address the raw file.
pub fn snippets_from_highlight(highlighted: &str, body_line: usize, max: usize) -> Vec<Snippet> {
    highlighted
        .lines()
        .enumerate()
        .filter(|(_, line)| line.contains(HL_START))
        .take(max)
        .map(|(idx, line)| Snippet {
            line: body_line + idx + 1,
            text: window(line),
        })
        .collect()
}

/// Trim `line` to a window starting a little before its first hit.
///
/// Works on visible characters tagged with "inside a hit", then re-renders
/// the markers from those tags. That keeps the output balanced by
/// construction, even when the window edge falls in the middle of a hit, and
/// keeps cuts on `char` boundaries for Cyrillic and other multi-byte text.
fn window(line: &str) -> String {
    let mut visible: Vec<(char, bool)> = Vec::new();
    let mut in_hit = false;
    for c in line.trim().chars() {
        match c {
            HL_START => in_hit = true,
            HL_END => in_hit = false,
            _ => visible.push((c, in_hit)),
        }
    }

    let first_hit = visible.iter().position(|&(_, h)| h).unwrap_or(0);
    let start = first_hit.saturating_sub(LEAD);
    let end = (start + WIDTH).min(visible.len());

    let mut out = String::new();
    if start > 0 {
        out.push('…');
    }
    let mut open = false;
    for &(c, hit) in &visible[start..end] {
        if hit != open {
            out.push(if hit { HL_START } else { HL_END });
            open = hit;
        }
        out.push(c);
    }
    if open {
        out.push(HL_END);
    }
    if end < visible.len() {
        out.push('…');
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn hl(s: &str) -> String {
        s.replace('[', &HL_START.to_string())
            .replace(']', &HL_END.to_string())
    }

    fn plain(s: &str) -> String {
        s.replace(HL_START, "[").replace(HL_END, "]")
    }

    fn balanced(s: &str) -> bool {
        let mut depth = 0i32;
        for c in s.chars() {
            if c == HL_START {
                depth += 1;
            } else if c == HL_END {
                depth -= 1;
            }
            if !(0..=1).contains(&depth) {
                return false;
            }
        }
        depth == 0
    }

    #[test]
    fn one_snippet_per_line_with_a_hit() {
        let body = hl("intro\nfirst [hit] here\nnothing\nsecond [hit]\n");
        let got = snippets_from_highlight(&body, 0, 5);
        assert_eq!(got.len(), 2);
        assert_eq!(got[0].line, 2);
        assert_eq!(plain(&got[0].text), "first [hit] here");
        assert_eq!(got[1].line, 4);
    }

    #[test]
    fn line_numbers_are_offset_by_the_frontmatter() {
        let body = hl("[hit]\n");
        let got = snippets_from_highlight(&body, 4, 3);
        assert_eq!(got[0].line, 5);
    }

    #[test]
    fn at_most_max_snippets() {
        let body = hl("[a]\n[b]\n[c]\n[d]\n");
        assert_eq!(snippets_from_highlight(&body, 0, 3).len(), 3);
    }

    #[test]
    fn long_lines_are_windowed_around_the_hit() {
        let line = format!("{} [needle] {}", "x".repeat(200), "y".repeat(300));
        let got = snippets_from_highlight(&hl(&line), 0, 1);
        let text = plain(&got[0].text);
        assert!(text.starts_with('…'), "{text}");
        assert!(text.ends_with('…'), "{text}");
        assert!(text.contains("[needle]"));
        // LEAD characters of context before the hit, give or take the space.
        let before = text.find('[').unwrap();
        assert!(before <= LEAD + '…'.len_utf8() + 1, "{before}");
        assert!(text.chars().count() <= WIDTH + 4);
    }

    #[test]
    fn a_window_cutting_through_a_hit_stays_balanced() {
        // The hit itself is longer than the window.
        let line = format!("[{}] tail", "z".repeat(400));
        let got = snippets_from_highlight(&hl(&line), 0, 1);
        assert!(balanced(&got[0].text), "{}", plain(&got[0].text));
    }

    #[test]
    fn cyrillic_lines_cut_on_char_boundaries() {
        let line = format!("{} [слово] {}", "щ".repeat(120), "ж".repeat(300));
        let got = snippets_from_highlight(&hl(&line), 0, 1);
        assert!(plain(&got[0].text).contains("[слово]"));
        assert!(balanced(&got[0].text));
    }

    #[test]
    fn short_lines_are_kept_whole_and_trimmed() {
        let got = snippets_from_highlight(&hl("   - a [b] c   "), 0, 1);
        assert_eq!(plain(&got[0].text), "- a [b] c");
    }

    #[test]
    fn no_hits_no_snippets() {
        assert!(snippets_from_highlight("plain text\nmore", 0, 3).is_empty());
    }
}
