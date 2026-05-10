use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::sync::OnceLock;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct NoteMeta {
    pub title: Option<String>,
    pub tags: Vec<String>,
    pub created: Option<String>,
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
            WikiLink { target, alias, is_embed }
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
                    headings.push(Heading { level, text: buf.clone() });
                }
            }
            _ => {}
        }
    }

    headings
}
