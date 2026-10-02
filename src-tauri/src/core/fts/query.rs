//! The full-text query language, parsed into pieces the index can run
//! safely.
//!
//! Supported syntax:
//!
//! - `word word`      — every word must match (AND); each word is a prefix,
//!   so `прогр` finds `программирование`
//! - `"exact phrase"` — the words in this order, no prefix expansion
//! - `-word`, `-"phrase"` — exclude notes that contain it
//! - `a OR b`         — either side; binds tighter than the implicit AND, so
//!   `a OR b c` reads as `(a OR b) AND c`, the way search engines do it
//! - `path:foo`       — vault-relative path contains `foo`
//! - `file:foo`       — file name (without `.md`) contains `foo`
//! - `tag:foo`        — note carries `#foo` (or a nested `#foo/…`) in its body
//!   or frontmatter
//! - `-path:`, `-file:`, `-tag:` — the same filters, negated
//!
//! Why a hand-written parser instead of passing the text to FTS5: FTS5's own
//! query syntax treats `"`, `*`, `^`, `:`, `(`, `)`, `-`, `+`, `NEAR`, `AND`,
//! `NOT` and column names as operators, so a perfectly normal search for
//! `C++`, `node:fs` or `don't` either throws a syntax error or silently means
//! something else. Here every user term is emitted as a double-quoted FTS5
//! string (quotes doubled inside), which FTS5 treats as plain text to
//! tokenize. The only operators in the final expression are the ones we
//! write ourselves, so no input can produce a syntax error or smuggle in a
//! column filter.

/// One searchable unit of user text.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Term {
    /// A bare word; matched as a prefix.
    Word(String),
    /// A quoted phrase; matched exactly, in order.
    Phrase(String),
}

/// A `key:value` filter applied in SQL rather than through FTS5 — paths and
/// file names are identifiers, not prose, and want substring semantics that
/// a token index cannot give.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Filter {
    /// Lower-cased value; the matching columns are stored lower-cased too.
    pub value: String,
    pub negated: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ParsedQuery {
    /// Conjunction of disjunctions: every group must match, and a group
    /// matches when any of its terms does.
    pub groups: Vec<Vec<Term>>,
    /// Terms whose notes are removed from the result.
    pub excluded: Vec<Term>,
    pub paths: Vec<Filter>,
    pub files: Vec<Filter>,
    pub tags: Vec<Filter>,
}

impl ParsedQuery {
    /// True when the query carries nothing that could select a note. A
    /// query of only exclusions also counts: "every note except these" is
    /// never what somebody typing into a search box wants.
    pub fn is_empty(&self) -> bool {
        self.groups.is_empty() && !self.has_filters()
    }

    pub fn has_filters(&self) -> bool {
        !self.paths.is_empty() || !self.files.is_empty() || !self.tags.is_empty()
    }

    /// FTS5 MATCH expression for the positive terms, `None` when there are
    /// none (a filter-only query).
    pub fn match_expr(&self) -> Option<String> {
        if self.groups.is_empty() {
            return None;
        }
        let parts: Vec<String> = self
            .groups
            .iter()
            .map(|g| {
                let alts: Vec<String> = g.iter().map(term_expr).collect();
                if alts.len() == 1 {
                    alts.into_iter().next().unwrap_or_default()
                } else {
                    format!("({})", alts.join(" OR "))
                }
            })
            .collect();
        Some(parts.join(" AND "))
    }

    /// FTS5 MATCH expression matching any excluded term. The index runs it
    /// as a `NOT IN` subquery instead of FTS5's binary `NOT`, which cannot
    /// stand on its own — `-draft path:work` has no positive term to hang it
    /// from.
    pub fn exclude_expr(&self) -> Option<String> {
        if self.excluded.is_empty() {
            return None;
        }
        let alts: Vec<String> = self.excluded.iter().map(term_expr).collect();
        Some(alts.join(" OR "))
    }
}

/// Fold `ё` to `е`. SQLite's `remove_diacritics` only knows Latin-script
/// diacritics, and Russian text is written both ways — `ёлка` and `елка` are
/// the same word to a reader, so they must be to the index. Applied
/// identically to indexed text and to every query term and filter value.
/// One char in, one char out, so offsets into folded text stay valid for the
/// original.
pub fn fold_yo(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'ё' => 'е',
            'Ё' => 'Е',
            other => other,
        })
        .collect()
}

/// Render one term as an FTS5 string. Doubling `"` is the only escape FTS5
/// strings have, and it is enough: inside quotes nothing else is an operator.
fn term_expr(term: &Term) -> String {
    match term {
        Term::Word(w) => format!("\"{}\"*", fold_yo(w).replace('"', "\"\"")),
        Term::Phrase(p) => format!("\"{}\"", fold_yo(p).replace('"', "\"\"")),
    }
}

/// A term FTS5 would tokenize to nothing (`+++`, `—`, `…`). Dropped up front:
/// an empty phrase never matches, so keeping one in an AND would make the
/// whole query return nothing for a reason the user cannot see.
fn has_token_chars(s: &str) -> bool {
    s.chars().any(char::is_alphanumeric)
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum FilterKind {
    Path,
    File,
    Tag,
}

#[derive(Debug)]
enum Token {
    Term { term: Term, negated: bool },
    Or,
    Filter { kind: FilterKind, filter: Filter },
}

/// Parse user text. Total: every input, however malformed, yields a query.
/// An unterminated quote runs to the end of the input; a dangling `OR` or a
/// lone `-` is ignored.
pub fn parse_query(input: &str) -> ParsedQuery {
    let mut q = ParsedQuery::default();
    // Set by `OR` between two positive terms; anything else in between
    // (an exclusion, a filter) breaks the chain.
    let mut pending_or = false;

    for token in tokenize(input) {
        match token {
            Token::Or => {
                pending_or = !q.groups.is_empty();
            }
            Token::Term { term, negated } => {
                if negated {
                    q.excluded.push(term);
                    pending_or = false;
                } else if pending_or {
                    if let Some(last) = q.groups.last_mut() {
                        last.push(term);
                    }
                    pending_or = false;
                } else {
                    q.groups.push(vec![term]);
                }
            }
            Token::Filter { kind, filter } => {
                pending_or = false;
                match kind {
                    FilterKind::Path => q.paths.push(filter),
                    FilterKind::File => q.files.push(filter),
                    FilterKind::Tag => q.tags.push(filter),
                }
            }
        }
    }
    q
}

const FILTER_KEYS: &[(&str, FilterKind)] = &[
    ("path:", FilterKind::Path),
    ("file:", FilterKind::File),
    ("tag:", FilterKind::Tag),
];

fn tokenize(input: &str) -> Vec<Token> {
    let chars: Vec<char> = input.chars().collect();
    let mut tokens = Vec::new();
    let mut i = 0;

    while i < chars.len() {
        if chars[i].is_whitespace() {
            i += 1;
            continue;
        }

        // `-` negates only when glued to what follows; ` - ` is punctuation.
        let negated = chars[i] == '-' && chars.get(i + 1).is_some_and(|c| !c.is_whitespace());
        if negated {
            i += 1;
        }

        if chars[i] == '"' {
            let (text, next) = read_quoted(&chars, i);
            i = next;
            if has_token_chars(&text) {
                tokens.push(Token::Term {
                    term: Term::Phrase(collapse_ws(&text)),
                    negated,
                });
            }
            continue;
        }

        if let Some((kind, key_len)) = filter_key_at(&chars, i) {
            let start = i + key_len;
            let (raw, next) = if chars.get(start) == Some(&'"') {
                read_quoted(&chars, start)
            } else {
                read_word(&chars, start)
            };
            i = next;
            let mut value = fold_yo(&raw.trim().to_lowercase());
            if kind == FilterKind::Tag {
                value = value.trim_start_matches('#').to_string();
            }
            if !value.is_empty() {
                tokens.push(Token::Filter {
                    kind,
                    filter: Filter { value, negated },
                });
            }
            continue;
        }

        let (word, next) = read_word(&chars, i);
        i = next;
        if !negated && word == "OR" {
            tokens.push(Token::Or);
            continue;
        }
        if has_token_chars(&word) {
            tokens.push(Token::Term {
                term: Term::Word(word),
                negated,
            });
        }
    }
    tokens
}

/// Case-insensitive `path:` / `file:` / `tag:` at `i`.
fn filter_key_at(chars: &[char], i: usize) -> Option<(FilterKind, usize)> {
    FILTER_KEYS.iter().find_map(|(key, kind)| {
        let n = key.chars().count();
        let slice: String = chars.get(i..i + n)?.iter().collect();
        slice.eq_ignore_ascii_case(key).then_some((*kind, n))
    })
}

/// Read a `"…"` run starting at the opening quote. Returns the inner text and
/// the index just past the closing quote (or the end of input).
fn read_quoted(chars: &[char], open: usize) -> (String, usize) {
    let mut j = open + 1;
    let mut out = String::new();
    while j < chars.len() && chars[j] != '"' {
        out.push(chars[j]);
        j += 1;
    }
    (out, (j + 1).min(chars.len()))
}

fn read_word(chars: &[char], start: usize) -> (String, usize) {
    let mut j = start;
    let mut out = String::new();
    while j < chars.len() && !chars[j].is_whitespace() {
        out.push(chars[j]);
        j += 1;
    }
    (out, j)
}

fn collapse_ws(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

#[cfg(test)]
mod tests {
    use super::*;

    fn words(ws: &[&str]) -> Vec<Vec<Term>> {
        ws.iter().map(|w| vec![Term::Word(w.to_string())]).collect()
    }

    fn f(v: &str) -> Filter {
        Filter {
            value: v.into(),
            negated: false,
        }
    }

    #[test]
    fn plain_words_are_anded_prefixes() {
        let q = parse_query("rust  tauri");
        assert_eq!(q.groups, words(&["rust", "tauri"]));
        assert_eq!(q.match_expr().unwrap(), r#""rust"* AND "tauri"*"#);
    }

    #[test]
    fn a_quoted_phrase_is_exact_and_whitespace_collapsed() {
        let q = parse_query(r#""local   first" notes"#);
        assert_eq!(
            q.groups,
            vec![
                vec![Term::Phrase("local first".into())],
                vec![Term::Word("notes".into())]
            ]
        );
        assert_eq!(q.match_expr().unwrap(), r#""local first" AND "notes"*"#);
    }

    #[test]
    fn an_unterminated_quote_runs_to_the_end() {
        let q = parse_query(r#"a "open phrase"#);
        assert_eq!(q.groups[1], vec![Term::Phrase("open phrase".into())]);
    }

    #[test]
    fn minus_excludes_words_and_phrases() {
        let q = parse_query(r#"garden -draft -"old idea""#);
        assert_eq!(q.groups, words(&["garden"]));
        assert_eq!(
            q.excluded,
            vec![Term::Word("draft".into()), Term::Phrase("old idea".into())]
        );
        assert_eq!(q.exclude_expr().unwrap(), r#""draft"* OR "old idea""#);
    }

    #[test]
    fn a_lone_or_spaced_minus_is_not_a_negation() {
        let q = parse_query("a - b -");
        assert_eq!(q.groups, words(&["a", "b"]));
        assert!(q.excluded.is_empty());
    }

    #[test]
    fn or_groups_adjacent_terms() {
        let q = parse_query("cat OR dog food");
        assert_eq!(
            q.groups,
            vec![
                vec![Term::Word("cat".into()), Term::Word("dog".into())],
                vec![Term::Word("food".into())]
            ]
        );
        assert_eq!(q.match_expr().unwrap(), r#"("cat"* OR "dog"*) AND "food"*"#);
    }

    #[test]
    fn or_chains_extend_one_group() {
        let q = parse_query("a OR b OR c");
        assert_eq!(q.groups.len(), 1);
        assert_eq!(q.groups[0].len(), 3);
    }

    #[test]
    fn dangling_or_is_ignored() {
        assert_eq!(parse_query("OR a").groups, words(&["a"]));
        assert_eq!(parse_query("a OR").groups, words(&["a"]));
        // An exclusion breaks the chain: `b` is a new AND group.
        assert_eq!(parse_query("a OR -x b").groups, words(&["a", "b"]));
    }

    #[test]
    fn lowercase_or_is_a_word() {
        // `or` is an ordinary word in prose; only the shouted form is an
        // operator, the same convention web search uses.
        assert_eq!(parse_query("this or that").groups.len(), 3);
    }

    #[test]
    fn filters_are_extracted_and_lowercased() {
        let q = parse_query("PATH:Projects/Work file:Daily tag:#ML word");
        assert_eq!(q.paths, vec![f("projects/work")]);
        assert_eq!(q.files, vec![f("daily")]);
        assert_eq!(q.tags, vec![f("ml")]);
        assert_eq!(q.groups, words(&["word"]));
    }

    #[test]
    fn filters_accept_quoted_values_and_negation() {
        let q = parse_query(r#"path:"Knowledge Base" -tag:draft -file:tmp"#);
        assert_eq!(q.paths, vec![f("knowledge base")]);
        assert_eq!(
            q.tags,
            vec![Filter {
                value: "draft".into(),
                negated: true
            }]
        );
        assert!(q.files[0].negated);
        assert!(q.groups.is_empty());
        assert!(!q.is_empty(), "filters alone are a valid query");
    }

    #[test]
    fn empty_filter_values_are_dropped() {
        let q = parse_query("path: tag:# file:\"\"");
        assert!(!q.has_filters());
    }

    #[test]
    fn unknown_prefixes_are_just_words() {
        let q = parse_query("node:fs");
        assert_eq!(q.groups, words(&["node:fs"]));
    }

    #[test]
    fn fts_operators_in_user_text_are_quoted_away() {
        for input in [
            "NEAR(a b)",
            "a AND b",
            "NOT x",
            "title:secret",
            "^start",
            "c++",
            "x*",
            "(a OR b",
            "a\"b",
            "{body}: x",
        ] {
            let q = parse_query(input);
            let expr = q.match_expr().unwrap_or_default();
            // Every term sits inside quotes, so outside of them the only
            // things left are our own operators and grouping.
            let outside: String = expr
                .split('"')
                .enumerate()
                .filter(|(i, _)| i % 2 == 0)
                .map(|(_, s)| s)
                .collect();
            let cleaned = outside
                .replace(" AND ", "")
                .replace(" OR ", "")
                .replace(['*', '(', ')'], "");
            assert!(cleaned.trim().is_empty(), "{input:?} leaked {outside:?}");
        }
    }

    #[test]
    fn embedded_quotes_are_doubled() {
        // A quote inside a word does not open a phrase; it stays part of
        // the word and is escaped.
        let q = parse_query("a\"b");
        assert_eq!(q.match_expr().unwrap(), r#""a""b"*"#);
        assert_eq!(term_expr(&Term::Word("x\"y".into())), r#""x""y"*"#);
    }

    #[test]
    fn punctuation_only_terms_are_dropped() {
        let q = parse_query("+++ — \"…\" -!!");
        assert!(q.is_empty());
        assert_eq!(q.match_expr(), None);
    }

    #[test]
    fn exclusions_alone_are_an_empty_query() {
        assert!(parse_query("-draft").is_empty());
        assert!(!parse_query("-draft tag:x").is_empty());
    }

    #[test]
    fn cyrillic_terms_survive_untouched() {
        let q = parse_query("Программирование -черновик tag:идеи");
        assert_eq!(q.groups, words(&["Программирование"]));
        assert_eq!(q.excluded, vec![Term::Word("черновик".into())]);
        assert_eq!(q.tags, vec![f("идеи")]);
    }

    #[test]
    fn yo_is_folded_in_terms_and_filters() {
        let q = parse_query("Ёлка \"ещё раз\" path:Учёба");
        assert_eq!(q.match_expr().unwrap(), r#""Елка"* AND "еще раз""#);
        assert_eq!(q.paths, vec![f("учеба")]);
        assert_eq!(fold_yo("ёЁе"), "еЕе");
    }

    #[test]
    fn empty_and_blank_input() {
        assert!(parse_query("").is_empty());
        assert!(parse_query("   \t\n ").is_empty());
    }
}
