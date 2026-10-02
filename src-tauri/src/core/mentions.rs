//! Unlinked mentions: places where a note is named in plain text but not
//! linked.
//!
//! A vault grows links unevenly — you write "talked to Anna about the garden
//! plan" long before `Garden plan` exists as a note, and nothing ever goes
//! back to connect the two. Obsidian's answer is a list of those mentions next
//! to the backlinks, each one a click away from becoming a real `[[link]]`.
//!
//! Everything here is pure text in, text out, so the rules that decide what
//! counts as a mention can be tested on their own:
//!
//! - **Whole words, any case, `ё` = `е`.** `Rust` must not light up inside
//!   `Rustacean`, and `ёлка`/`Елка` are the same word to a Russian reader —
//!   the same folding the full-text index applies. Word characters are
//!   Unicode letters and digits (plus `_` and combining marks), so a Cyrillic
//!   name gets real boundaries rather than ASCII `\b`, which treats every
//!   Cyrillic letter as a non-word character.
//! - **Not where it would break something.** Text inside an existing
//!   `[[wikilink]]` or `[markdown](link)`, inline code, a code fence, the
//!   frontmatter, a URL or a `#tag` is never offered: wrapping it in `[[…]]`
//!   would corrupt the link, the code sample, the YAML or the tag.
//! - **The longest name wins.** With a title `Machine learning` and an alias
//!   `Machine`, the phrase is one mention, not a mention plus a stray word.
//!
//! The command layer (`commands::mentions`) finds candidate notes through the
//! full-text index and then runs these functions over the real file text —
//! the index tokenizes away the punctuation and line structure these rules
//! depend on.

use std::collections::HashSet;
use std::ops::Range;
use std::sync::OnceLock;

use regex::Regex;
use serde::Serialize;

use crate::core::links::{link_key, note_stem};

/// Names shorter than this (in characters) are not searched for: `AI`, `Go`
/// or `ML` match half the vault as ordinary words and drown the list.
pub const MIN_NAME_CHARS: usize = 3;

/// Characters of context kept on each side of a hit in its snippet.
const SNIPPET_CONTEXT_CHARS: usize = 48;

/// One plain-text mention, located so the rewrite command can verify it is
/// still there before touching the file.
#[derive(Debug, Clone, Serialize, PartialEq, Eq)]
pub struct MentionHit {
    /// 1-based file line, for display and for addressing the occurrence.
    pub line: usize,
    /// Byte offset of the match within its line. Opaque to the frontend — it
    /// is only ever echoed back to `mention_link`.
    pub col: usize,
    /// The text as written in the note (original case, original `ё`).
    pub text: String,
    /// Context before the hit on the same line, `…`-prefixed when cut.
    pub before: String,
    /// Context after the hit on the same line, `…`-suffixed when cut.
    pub after: String,
}

/// Why a single-occurrence rewrite was refused.
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum LinkError {
    /// The note changed since the mention list was built: the occurrence is
    /// gone, moved, reads differently, or has become part of a link or code.
    #[error("This mention has changed since the list was loaded — refresh and try again")]
    Stale,
    /// The matched text contains link syntax and cannot sit inside `[[…]]`.
    #[error("This mention contains characters that cannot go inside a wikilink")]
    Unlinkable,
}

/// The names a note can be mentioned by: its title, its file stem and its
/// aliases, trimmed, de-duplicated under the same folding the matcher uses,
/// and without the ones too short to search for. Order is preserved (title
/// first) so the list reads naturally in the UI.
pub fn mention_names(title: &str, stem: &str, aliases: &[String]) -> Vec<String> {
    let mut seen: HashSet<String> = HashSet::new();
    let mut out = Vec::new();
    for name in std::iter::once(title)
        .chain(std::iter::once(stem))
        .chain(aliases.iter().map(String::as_str))
    {
        let name = name.trim();
        if name.chars().filter(|c| !c.is_whitespace()).count() < MIN_NAME_CHARS {
            continue;
        }
        let key: String = name.chars().map(fold_char).collect();
        if seen.insert(key) {
            out.push(name.to_string());
        }
    }
    out
}

/// Case- and `ё`-folding for one character, one char in and one char out so
/// positions in folded text stay positions in the original. A character
/// whose lowercase form is several characters (`İ`) is left as is; it then
/// only matches itself, which is the conservative failure.
fn fold_char(c: char) -> char {
    match c {
        'ё' | 'Ё' => 'е',
        _ => {
            let mut lower = c.to_lowercase();
            match (lower.next(), lower.next()) {
                (Some(l), None) => l,
                _ => c,
            }
        }
    }
}

/// Part of a word for boundary purposes. Combining marks count, so a
/// decomposed `й` (`и` + U+0306) does not split a word in two.
fn is_word_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_' || ('\u{0300}'..='\u{036F}').contains(&c)
}

fn wikilink_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"!?\[\[[^\n]*?\]\]").unwrap())
}

/// `[text](dest)` and `![alt](src)`.
fn md_link_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"!?\[[^\]\n]*\]\([^)\n]*\)").unwrap())
}

/// `<scheme:…>` autolinks and bare URLs. A note named `example` must not be
/// linked inside `https://example.com/`.
fn url_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"<[A-Za-z][A-Za-z0-9+.\-]*:[^>\s]*>|(?:https?|ftp|file)://[^\s<>]+|mailto:[^\s<>]+|www\.[^\s<>]+")
            .unwrap()
    })
}

/// `#tag` the way the parser reads tags (`core::parser`): after a line start
/// or whitespace. Only the `#tag` part is excluded, not the whitespace.
fn hashtag_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?m)(?:^|\s)(#[\w\-/]+)").unwrap())
}

/// Byte length of a leading YAML frontmatter block (`---` … `---`/`...`),
/// including its closing line, or 0 when there is none. An unclosed opening
/// `---` is not frontmatter — the same call `gray_matter` makes.
fn frontmatter_len(text: &str) -> usize {
    let body = text.strip_prefix('\u{feff}').unwrap_or(text);
    let bom = text.len() - body.len();
    let mut lines = body.split_inclusive('\n');
    match lines.next() {
        Some(first) if first.trim_end() == "---" => {}
        _ => return 0,
    }
    let mut end = bom + body.split_inclusive('\n').next().map_or(0, str::len);
    for line in lines {
        end += line.len();
        let t = line.trim_end();
        if t == "---" || t == "..." {
            return end;
        }
    }
    0
}

/// A fence opener/closer: up to three spaces, then three or more of one
/// fence character. Returns the character and the run length.
fn fence_marker(line: &str) -> Option<(char, usize)> {
    let indent = line.len() - line.trim_start_matches(' ').len();
    if indent > 3 {
        return None;
    }
    let rest = &line[indent..];
    let ch = rest.chars().next()?;
    if ch != '`' && ch != '~' {
        return None;
    }
    let run = rest.chars().take_while(|&c| c == ch).count();
    (run >= 3).then_some((ch, run))
}

/// Inline code spans on one line, as byte ranges relative to the line: a run
/// of N backticks up to the next run of exactly N. An unmatched run is
/// literal text, per CommonMark.
fn inline_code_spans(line: &str) -> Vec<Range<usize>> {
    let bytes = line.as_bytes();
    let mut spans = Vec::new();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] != b'`' {
            i += 1;
            continue;
        }
        let open = i;
        while i < bytes.len() && bytes[i] == b'`' {
            i += 1;
        }
        let n = i - open;
        // Look for a closing run of exactly `n`.
        let mut j = i;
        let mut closed = None;
        while j < bytes.len() {
            if bytes[j] != b'`' {
                j += 1;
                continue;
            }
            let start = j;
            while j < bytes.len() && bytes[j] == b'`' {
                j += 1;
            }
            if j - start == n {
                closed = Some(j);
                break;
            }
        }
        match closed {
            Some(end) => {
                spans.push(open..end);
                i = end;
            }
            None => i = open + n,
        }
    }
    spans
}

/// Byte ranges of `text` where a mention must not be offered: frontmatter,
/// fenced code (fence lines included), inline code, wikilinks and embeds,
/// markdown links and images, URLs and `#tags`. Ranges may overlap; callers
/// only ask "does a hit touch any of them".
pub fn excluded_ranges(text: &str) -> Vec<Range<usize>> {
    let mut out = Vec::new();
    let fm = frontmatter_len(text);
    if fm > 0 {
        out.push(0..fm);
    }

    let mut offset = 0usize;
    let mut fence: Option<(char, usize)> = None;
    for line in text.split_inclusive('\n') {
        let start = offset;
        offset += line.len();
        if start < fm {
            continue;
        }
        let content = line.trim_end_matches(['\n', '\r']);
        match fence {
            Some((ch, n)) => {
                out.push(start..offset);
                // A closer is the same character, at least as long, and
                // nothing else on the line.
                if let Some((c2, n2)) = fence_marker(content) {
                    if c2 == ch && n2 >= n && content.trim().chars().all(|c| c == ch) {
                        fence = None;
                    }
                }
            }
            None => {
                if let Some(marker) = fence_marker(content) {
                    // An unclosed fence runs to the end of the document,
                    // as CommonMark has it.
                    fence = Some(marker);
                    out.push(start..offset);
                } else {
                    for span in inline_code_spans(content) {
                        out.push(start + span.start..start + span.end);
                    }
                }
            }
        }
    }

    for re in [wikilink_re(), md_link_re(), url_re()] {
        out.extend(re.find_iter(text).map(|m| m.range()));
    }
    out.extend(
        hashtag_re()
            .captures_iter(text)
            .filter_map(|c| c.get(1).map(|m| m.range())),
    );
    out
}

/// Try to match the folded `name` at `chars[i..]`. Whitespace in the name
/// matches any run of whitespace in the text, so `Machine learning` still
/// finds `Machine  learning`. Returns the exclusive end index into `chars`.
fn match_at(chars: &[(usize, char)], i: usize, name: &[char]) -> Option<usize> {
    let mut j = i;
    let mut k = 0;
    while k < name.len() {
        if name[k].is_whitespace() {
            if j >= chars.len() || !chars[j].1.is_whitespace() {
                return None;
            }
            while j < chars.len() && chars[j].1.is_whitespace() {
                j += 1;
            }
            while k < name.len() && name[k].is_whitespace() {
                k += 1;
            }
            continue;
        }
        if j >= chars.len() || fold_char(chars[j].1) != name[k] {
            return None;
        }
        j += 1;
        k += 1;
    }
    // Word boundaries apply only where the name itself starts or ends with a
    // word character: `C++` may be followed by a letter-free `,` or space
    // either way, but `Rust` must not continue into `Rustacean`.
    if is_word_char(name[0]) && i > 0 && is_word_char(chars[i - 1].1) {
        return None;
    }
    if is_word_char(name[name.len() - 1]) && j < chars.len() && is_word_char(chars[j].1) {
        return None;
    }
    Some(j)
}

/// A located occurrence, before it is dressed up as a [`MentionHit`].
#[derive(Debug, Clone, PartialEq, Eq)]
struct Occurrence {
    /// Byte range in the whole text.
    range: Range<usize>,
    /// 0-based line.
    line: usize,
    /// Byte offset within the line.
    col: usize,
}

fn find_occurrences(text: &str, names: &[String]) -> Vec<Occurrence> {
    // Longest first, so a title wins over an alias that is a prefix of it.
    let mut folded: Vec<Vec<char>> = names
        .iter()
        .map(|n| n.trim().chars().map(fold_char).collect::<Vec<_>>())
        .filter(|n| !n.is_empty())
        .collect();
    folded.sort_by_key(|n| std::cmp::Reverse(n.len()));
    folded.dedup();
    if folded.is_empty() {
        return Vec::new();
    }

    let mut excluded = vec![false; text.len()];
    for r in excluded_ranges(text) {
        for b in &mut excluded[r.start.min(text.len())..r.end.min(text.len())] {
            *b = true;
        }
    }

    let mut out = Vec::new();
    let mut line_start = 0usize;
    for (line_no, line) in text.split('\n').enumerate() {
        let chars: Vec<(usize, char)> = line.char_indices().collect();
        let byte_at = |idx: usize| chars.get(idx).map_or(line.len(), |&(b, _)| b);
        let mut i = 0;
        while i < chars.len() {
            let hit = folded.iter().find_map(|name| {
                let end = match_at(&chars, i, name)?;
                let (s, e) = (line_start + byte_at(i), line_start + byte_at(end));
                (!excluded[s..e].iter().any(|&x| x)).then_some((end, s..e))
            });
            match hit {
                Some((end, range)) => {
                    out.push(Occurrence {
                        line: line_no,
                        col: range.start - line_start,
                        range,
                    });
                    i = end;
                }
                None => i += 1,
            }
        }
        line_start += line.len() + 1;
    }
    out
}

/// Every plain-text mention of any of `names` in `text`, in document order,
/// with a one-line snippet each.
pub fn find_mentions(text: &str, names: &[String]) -> Vec<MentionHit> {
    let lines: Vec<&str> = text.split('\n').collect();
    find_occurrences(text, names)
        .into_iter()
        .map(|o| {
            let line = lines[o.line].trim_end_matches('\r');
            let len = o.range.len();
            let before_full = &line[..o.col];
            let after_full = &line[(o.col + len).min(line.len())..];
            MentionHit {
                line: o.line + 1,
                col: o.col,
                text: text[o.range].to_string(),
                before: clip_start(before_full.trim_start(), SNIPPET_CONTEXT_CHARS),
                after: clip_end(after_full.trim_end(), SNIPPET_CONTEXT_CHARS),
            }
        })
        .collect()
}

fn clip_start(s: &str, max: usize) -> String {
    let n = s.chars().count();
    if n <= max {
        return s.to_string();
    }
    let tail: String = s.chars().skip(n - max).collect();
    format!("…{}", tail.trim_start())
}

fn clip_end(s: &str, max: usize) -> String {
    if s.chars().count() <= max {
        return s.to_string();
    }
    let head: String = s.chars().take(max).collect();
    format!("{}…", head.trim_end())
}

/// The wikilink that replaces `matched`: `[[Target]]` when the text already
/// is the link name exactly, otherwise `[[Target|matched]]` so the sentence
/// reads exactly as before.
pub fn wikilink_for(link_name: &str, matched: &str) -> Result<String, LinkError> {
    if matched.contains(['[', ']', '|', '\n']) || link_name.contains(['[', ']', '|', '\n']) {
        return Err(LinkError::Unlinkable);
    }
    Ok(if matched == link_name {
        format!("[[{link_name}]]")
    } else {
        format!("[[{link_name}|{matched}]]")
    })
}

/// Link the single mention at `line` (1-based) / `col` (byte in line) whose
/// text is `expected`, returning the new note text.
///
/// The occurrence is located afresh in `text` rather than trusted: if the
/// note was edited since the list was built — the word moved, changed, or
/// now sits inside a link or code — the rewrite is refused instead of
/// splicing `[[…]]` into whatever happens to be at that offset now.
pub fn link_one(
    text: &str,
    names: &[String],
    link_name: &str,
    line: usize,
    col: usize,
    expected: &str,
) -> Result<String, LinkError> {
    let occ = find_occurrences(text, names)
        .into_iter()
        .find(|o| o.line + 1 == line && o.col == col && &text[o.range.clone()] == expected)
        .ok_or(LinkError::Stale)?;
    let link = wikilink_for(link_name, expected)?;
    let mut out = String::with_capacity(text.len() + link.len());
    out.push_str(&text[..occ.range.start]);
    out.push_str(&link);
    out.push_str(&text[occ.range.end..]);
    Ok(out)
}

/// Link every mention in `text`. Returns the new text and how many were
/// linked; occurrences that cannot sit inside a wikilink are left alone.
pub fn link_all(text: &str, names: &[String], link_name: &str) -> (String, usize) {
    let mut out = text.to_string();
    let mut count = 0;
    // Back to front, so earlier ranges stay valid while later ones change.
    for occ in find_occurrences(text, names).into_iter().rev() {
        let Ok(link) = wikilink_for(link_name, &text[occ.range.clone()]) else {
            continue;
        };
        out.replace_range(occ.range, &link);
        count += 1;
    }
    (out, count)
}

/// What a link has to say to reach the target note, for deciding whether a
/// note already links to it. Built from the same names the graph resolves
/// by (path, file stem, title, alias), lowercased.
#[derive(Debug, Clone, Default)]
pub struct TargetKeys {
    /// Extension-less vault path, lowercased.
    pub path: String,
    pub stem: String,
    pub title: String,
    /// Only aliases no real note is called — an alias never steals a link
    /// from the note that actually carries the name.
    pub aliases: Vec<String>,
}

impl TargetKeys {
    pub fn new(rel: &str, title: &str, aliases: &[String], real_names: &HashSet<String>) -> Self {
        let path = rel
            .strip_suffix(".md.age")
            .or_else(|| rel.strip_suffix(".md"))
            .unwrap_or(rel)
            .to_lowercase();
        Self {
            path,
            stem: note_stem(rel).to_lowercase(),
            title: title.trim().to_lowercase(),
            aliases: aliases
                .iter()
                .map(|a| a.trim().to_lowercase())
                .filter(|a| !a.is_empty() && !real_names.contains(a))
                .collect(),
        }
    }

    /// Does a wikilink written as `target` reach this note? Mirrors the
    /// graph's resolution (full path, then the last path segment as a stem,
    /// then title, then alias) without its first-writer tie-breaks: a link
    /// that *could* mean this note is treated as linking it, which only ever
    /// hides a suggestion, never offers a duplicate.
    pub fn is_linked_by(&self, target: &str) -> bool {
        let key = link_key(target);
        if key.is_empty() {
            return false;
        }
        let last = key.rsplit('/').next().unwrap_or(&key);
        key == self.path || last == self.stem || key == self.title || self.aliases.contains(&key)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn names(ns: &[&str]) -> Vec<String> {
        ns.iter().map(|s| s.to_string()).collect()
    }

    fn texts(text: &str, ns: &[&str]) -> Vec<String> {
        find_mentions(text, &names(ns))
            .into_iter()
            .map(|h| h.text)
            .collect()
    }

    // ---- names ------------------------------------------------------------

    #[test]
    fn names_are_deduped_folded_and_short_ones_dropped() {
        let got = mention_names(
            "Ёлка",
            "елка",
            &names(&["ML", "Новогодняя ёлка", "  ", "ёЛКА", "abc"]),
        );
        assert_eq!(got, vec!["Ёлка", "Новогодняя ёлка", "abc"]);
    }

    #[test]
    fn three_chars_is_enough_and_whitespace_does_not_count() {
        assert_eq!(mention_names("Go", "a b", &[]), Vec::<String>::new());
        assert_eq!(mention_names("Vue", "vue", &[]), vec!["Vue"]);
    }

    // ---- matching ---------------------------------------------------------

    #[test]
    fn latin_whole_word_case_insensitive() {
        assert_eq!(
            texts(
                "Rust is nice. rust! RUST? Rustacean, trust, rusty",
                &["Rust"]
            ),
            vec!["Rust", "rust", "RUST"]
        );
    }

    #[test]
    fn cyrillic_word_boundaries_work() {
        // ASCII `\b` would match `Сад` inside `Садовник`: every Cyrillic
        // letter is a non-word character to it.
        assert_eq!(
            texts("Сад цветёт. В саду — сад, садовник и Сад.", &["Сад"]),
            vec!["Сад", "сад", "Сад"]
        );
    }

    #[test]
    fn yo_and_ye_are_the_same_letter() {
        assert_eq!(
            texts("Ёлка, елка и ЕЛКА — ёлки", &["ёлка"]),
            vec!["Ёлка", "елка", "ЕЛКА"]
        );
        assert_eq!(texts("Купили ёлку и Елку", &["Елку"]), vec!["ёлку", "Елку"]);
    }

    #[test]
    fn punctuation_is_a_boundary_but_word_glue_is_not() {
        assert_eq!(
            texts(
                "(Garden), \"Garden\". Garden's garden_x xgarden garden-plan",
                &["Garden"]
            ),
            vec!["Garden", "Garden", "Garden", "garden"]
        );
        // A name ending in punctuation needs no boundary there.
        assert_eq!(texts("I like C++, and C++x.", &["C++"]), vec!["C++", "C++"]);
    }

    #[test]
    fn multiple_hits_per_line_with_columns() {
        let hits = find_mentions("Сад и ещё сад", &names(&["сад"]));
        assert_eq!(hits.len(), 2);
        assert_eq!((hits[0].line, hits[0].col), (1, 0));
        assert_eq!(hits[1].line, 1);
        assert_eq!(hits[1].col, "Сад и ещё ".len());
        assert_eq!(hits[1].before, "Сад и ещё ");
        assert_eq!(hits[0].after, " и ещё сад");
    }

    #[test]
    fn aliases_match_and_the_longest_name_wins() {
        assert_eq!(
            texts(
                "Machine learning and machine   learning, then just Machine.",
                &["Machine", "Machine learning"]
            ),
            vec!["Machine learning", "machine   learning", "Machine"]
        );
    }

    #[test]
    fn line_numbers_are_file_lines_and_snippets_are_clipped() {
        let long = format!("{} Garden {}", "x".repeat(80), "y".repeat(80));
        let text = format!("---\ntitle: Garden\n---\nfirst\n{long}\r\n");
        let hits = find_mentions(&text, &names(&["Garden"]));
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].line, 5);
        assert!(hits[0].before.starts_with('…'));
        assert!(hits[0].after.ends_with('…'));
        assert!(!hits[0].after.contains('\r'));
    }

    // ---- exclusions -------------------------------------------------------

    #[test]
    fn existing_links_are_not_mentions() {
        assert_eq!(
            texts(
                "[[Garden]] ![[Garden]] [[Other|my Garden]] [Garden](garden.md) ![Garden](g.png) Garden",
                &["Garden"]
            ),
            vec!["Garden"]
        );
    }

    #[test]
    fn code_is_not_mentions() {
        let text = "`Garden` and ``a ` Garden`` here\n```\nGarden\n```\n~~~~rust\nGarden\n~~~\nstill fenced Garden\n~~~~\nGarden after";
        let hits = find_mentions(text, &names(&["Garden"]));
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].line, 10);
        // An unmatched backtick is literal text, not a code span.
        assert_eq!(texts("a ` Garden", &["Garden"]), vec!["Garden"]);
    }

    #[test]
    fn an_unclosed_fence_runs_to_the_end() {
        assert!(texts("```\nGarden\nGarden", &["Garden"]).is_empty());
    }

    #[test]
    fn frontmatter_urls_and_tags_are_not_mentions() {
        let text = "---\ntitle: Garden\naliases: [Garden]\n---\nhttps://garden.example/Garden <https://x.org/garden> www.garden.com #garden #garden/beds Garden";
        assert_eq!(texts(text, &["Garden"]), vec!["Garden"]);
        // Not frontmatter without a closing fence.
        assert_eq!(texts("---\nGarden", &["Garden"]), vec!["Garden"]);
    }

    // ---- rewriting --------------------------------------------------------

    #[test]
    fn wikilink_keeps_the_written_text_when_it_differs() {
        assert_eq!(wikilink_for("Garden", "Garden").unwrap(), "[[Garden]]");
        assert_eq!(
            wikilink_for("Garden", "garden").unwrap(),
            "[[Garden|garden]]"
        );
        assert_eq!(
            wikilink_for("ml", "Машинное обучение").unwrap(),
            "[[ml|Машинное обучение]]"
        );
        assert_eq!(wikilink_for("x", "a|b"), Err(LinkError::Unlinkable));
    }

    #[test]
    fn link_one_rewrites_exactly_that_occurrence() {
        let text = "Сад и сад\nсад";
        let ns = names(&["Сад"]);
        let hits = find_mentions(text, &ns);
        let out = link_one(text, &ns, "Сад", hits[1].line, hits[1].col, &hits[1].text).unwrap();
        assert_eq!(out, "Сад и [[Сад|сад]]\nсад");
        let out = link_one(text, &ns, "Сад", 1, 0, "Сад").unwrap();
        assert_eq!(out, "[[Сад]] и сад\nсад");
    }

    #[test]
    fn link_one_refuses_a_stale_occurrence() {
        let ns = names(&["Garden"]);
        // Text at that spot changed.
        assert_eq!(
            link_one("Gardens", &ns, "Garden", 1, 0, "Garden"),
            Err(LinkError::Stale)
        );
        // Moved to another column.
        assert_eq!(
            link_one(" Garden", &ns, "Garden", 1, 0, "Garden"),
            Err(LinkError::Stale)
        );
        // Same spot, different case than listed.
        assert_eq!(
            link_one("garden", &ns, "Garden", 1, 0, "Garden"),
            Err(LinkError::Stale)
        );
        // Already linked meanwhile.
        assert_eq!(
            link_one("[[Garden]]", &ns, "Garden", 1, 2, "Garden"),
            Err(LinkError::Stale)
        );
        // Line gone.
        assert_eq!(
            link_one("Garden", &ns, "Garden", 3, 0, "Garden"),
            Err(LinkError::Stale)
        );
    }

    #[test]
    fn link_all_rewrites_every_mention_and_nothing_else() {
        let text = "Garden, `Garden`, garden [[Garden]]\nmy Garden";
        let (out, n) = link_all(text, &names(&["Garden"]), "Garden");
        assert_eq!(n, 3);
        assert_eq!(
            out,
            "[[Garden]], `Garden`, [[Garden|garden]] [[Garden]]\nmy [[Garden]]"
        );
        // Idempotent: nothing left to link.
        assert_eq!(link_all(&out, &names(&["Garden"]), "Garden").1, 0);
    }

    // ---- already linked ---------------------------------------------------

    #[test]
    fn target_keys_cover_path_stem_title_and_alias() {
        let real: HashSet<String> = ["rust".to_string()].into_iter().collect();
        let keys = TargetKeys::new(
            "areas/Garden plan.md",
            "The Garden",
            &names(&["Огород", "Rust"]),
            &real,
        );
        for t in [
            "Garden plan",
            "garden plan#Beds",
            "areas/Garden plan",
            "other/Garden plan.md",
            "the garden",
            "огород",
        ] {
            assert!(keys.is_linked_by(t), "{t}");
        }
        // An alias shadowed by a real note's name does not count.
        assert!(!keys.is_linked_by("Rust"));
        assert!(!keys.is_linked_by("Garden"));
        assert!(!keys.is_linked_by(""));
    }
}
