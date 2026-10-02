use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NoteMeta {
    pub title: Option<String>,
    /// `#[serde(default)]` is load-bearing. Without it, frontmatter that omits
    /// `tags:` failed to deserialize as a whole, and `split_frontmatter` fell
    /// back to `NoteMeta::default()` — so a note with nothing but `title:` in
    /// its frontmatter had its title silently dropped. That title feeds the
    /// quick switcher, tab labels, backlink rows and graph nodes, all of which
    /// then showed the file stem instead. The `Option` fields default on their
    /// own; this one did not.
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub created: Option<String>,
    #[serde(default)]
    pub modified: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ParsedNote {
    pub meta: NoteMeta,
    pub body: String,
    pub headings: Vec<Heading>,
    pub wikilinks: Vec<WikiLink>,
    pub tags: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Heading {
    pub level: u32,
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct WikiLink {
    pub target: String,
    pub alias: Option<String>,
    pub is_embed: bool,
}

fn wikilink_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(!?)\[\[([^\]|]+)(?:\|([^\]]+))?\]\]").unwrap())
}

fn hashtag_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"(?:^|\s)#([\w\-/]+)").unwrap())
}

pub fn parse_note(raw: &str) -> ParsedNote {
    let (meta, body) = split_frontmatter(raw);

    let wikilinks = extract_wikilinks(&body);
    let tags = extract_hashtags(&body);
    let headings = extract_headings(&body);

    ParsedNote {
        meta,
        body,
        headings,
        wikilinks,
        tags,
    }
}

fn split_frontmatter(raw: &str) -> (NoteMeta, String) {
    let matter = gray_matter::Matter::<gray_matter::engine::YAML>::new();
    match matter.parse_with_struct::<NoteMeta>(raw) {
        Some(parsed) => (parsed.data, parsed.content),
        None => (NoteMeta::default(), raw.to_string()),
    }
}

fn extract_wikilinks(text: &str) -> Vec<WikiLink> {
    wikilink_re()
        .captures_iter(text)
        .map(|cap| {
            let is_embed = &cap[1] == "!";
            let target = cap[2].trim().to_string();
            let alias = cap.get(3).map(|m| m.as_str().trim().to_string());
            WikiLink {
                target,
                alias,
                is_embed,
            }
        })
        .collect()
}

fn extract_hashtags(text: &str) -> Vec<String> {
    hashtag_re()
        .captures_iter(text)
        .map(|cap| cap[1].to_string())
        .collect()
}

fn extract_headings(text: &str) -> Vec<Heading> {
    let opts = Options::ENABLE_STRIKETHROUGH | Options::ENABLE_TABLES;
    let parser = Parser::new_ext(text, opts);

    let mut headings = Vec::new();
    let mut current_level: Option<u32> = None;
    let mut buf = String::new();

    for event in parser {
        match event {
            Event::Start(Tag::Heading { level, .. }) => {
                current_level = Some(level as u32);
                buf.clear();
            }
            Event::Text(t) if current_level.is_some() => {
                buf.push_str(&t);
            }
            Event::End(TagEnd::Heading(_)) => {
                if let Some(level) = current_level.take() {
                    headings.push(Heading {
                        level,
                        text: buf.clone(),
                    });
                }
            }
            _ => {}
        }
    }

    headings
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- frontmatter ------------------------------------------------------

    #[test]
    fn title_survives_frontmatter_without_tags() {
        // The regression: `tags: Vec<String>` had no serde default, so
        // frontmatter omitting `tags:` failed to deserialize as a whole and
        // the title went with it. Every note that set only a title showed its
        // file stem in the switcher, tabs, backlinks and graph instead.
        let parsed = parse_note("---\ntitle: Real Title\n---\n\nbody\n");
        assert_eq!(parsed.meta.title.as_deref(), Some("Real Title"));
        assert!(parsed.meta.tags.is_empty());
    }

    #[test]
    fn tags_survive_frontmatter_without_a_title() {
        let parsed = parse_note("---\ntags: [ideas, ml]\n---\n\nbody\n");
        assert_eq!(parsed.meta.tags, vec!["ideas", "ml"]);
        assert_eq!(parsed.meta.title, None);
    }

    #[test]
    fn every_frontmatter_field_is_independently_optional() {
        let parsed = parse_note("---\ncreated: 2026-01-01\n---\n\nbody\n");
        assert_eq!(parsed.meta.created.as_deref(), Some("2026-01-01"));
        assert_eq!(parsed.meta.title, None);
        assert!(parsed.meta.tags.is_empty());
    }

    #[test]
    fn frontmatter_is_stripped_from_the_body() {
        let parsed = parse_note("---\ntitle: T\n---\n\n# Heading\n");
        assert!(!parsed.body.contains("title: T"));
        assert!(parsed.body.contains("# Heading"));
    }

    #[test]
    fn a_note_without_frontmatter_parses_as_all_body() {
        let parsed = parse_note("# Just a heading\n\nsome text\n");
        assert_eq!(parsed.meta.title, None);
        assert!(parsed.body.contains("# Just a heading"));
    }

    // ---- wikilinks --------------------------------------------------------

    #[test]
    fn wikilinks_capture_target_alias_and_embed() {
        let parsed = parse_note("[[Plain]] [[Target|Alias]] ![[Embedded]]\n");
        let links = &parsed.wikilinks;
        assert_eq!(links.len(), 3);

        assert_eq!(links[0].target, "Plain");
        assert_eq!(links[0].alias, None);
        assert!(!links[0].is_embed);

        assert_eq!(links[1].target, "Target");
        assert_eq!(links[1].alias.as_deref(), Some("Alias"));
        assert!(!links[1].is_embed);

        assert_eq!(links[2].target, "Embedded");
        assert!(links[2].is_embed);
    }

    #[test]
    fn wikilink_whitespace_is_trimmed() {
        let parsed = parse_note("[[  Spaced  |  Label  ]]\n");
        assert_eq!(parsed.wikilinks[0].target, "Spaced");
        assert_eq!(parsed.wikilinks[0].alias.as_deref(), Some("Label"));
    }

    #[test]
    fn a_path_qualified_wikilink_keeps_its_path() {
        let parsed = parse_note("[[folder/Note]]\n");
        assert_eq!(parsed.wikilinks[0].target, "folder/Note");
    }

    #[test]
    fn text_without_links_yields_none() {
        assert!(parse_note("just prose, and a [link](http://x)\n")
            .wikilinks
            .is_empty());
    }

    // ---- tags -------------------------------------------------------------

    #[test]
    fn hashtags_are_extracted_from_the_body() {
        let parsed = parse_note("thinking about #ml and #deep-learning today\n");
        assert!(parsed.tags.contains(&"ml".to_string()));
        assert!(parsed.tags.contains(&"deep-learning".to_string()));
    }

    #[test]
    fn a_hashtag_needs_whitespace_or_line_start_before_it() {
        // Otherwise a URL fragment or a CSS colour would read as a tag.
        let parsed = parse_note("see http://x.com/page#section and #real\n");
        assert!(parsed.tags.contains(&"real".to_string()));
        assert!(!parsed.tags.contains(&"section".to_string()));
    }

    #[test]
    fn nested_tags_keep_their_slashes() {
        let parsed = parse_note("#area/health matters\n");
        assert!(parsed.tags.contains(&"area/health".to_string()));
    }

    // ---- headings ---------------------------------------------------------

    #[test]
    fn headings_record_level_and_text() {
        let parsed = parse_note("# One\n\n## Two\n\n### Three\n");
        let got: Vec<(u32, &str)> = parsed
            .headings
            .iter()
            .map(|h| (h.level, h.text.as_str()))
            .collect();
        assert_eq!(got, vec![(1, "One"), (2, "Two"), (3, "Three")]);
    }

    #[test]
    fn a_heading_with_inline_markup_keeps_its_text() {
        let parsed = parse_note("# A **bold** heading\n");
        assert_eq!(parsed.headings[0].text, "A bold heading");
    }
}
