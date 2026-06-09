//! Helpers shared by detectors that ride the embedding index.

use super::super::detector::DetectorContext;

/// Map a `chunks_vec` distance to a 0.0-1.0 similarity score. The index
/// stores normalised embeddings, so the distance lands in roughly [0, 2]
/// (identical text ≈ 0). We treat 0 → 1.0 and 2 → 0.0, clamped. The
/// user-facing thresholds are percentages of this.
pub fn similarity(distance: f32) -> f32 {
    (1.0 - distance / 2.0).clamp(0.0, 1.0)
}

/// True if either note already contains a wikilink to the other. Heuristic:
/// we match the wikilink target's base name (case-insensitive) against the
/// other note's base name. Good enough for "is this pair already connected" —
/// a false negative just means we surface a pair the user can dismiss.
pub fn already_linked(ctx: &DetectorContext<'_>, a: &str, b: &str) -> bool {
    links_to(ctx, a, b) || links_to(ctx, b, a)
}

/// True when `from` contains a wikilink whose base name matches `to`'s.
pub fn links_to(ctx: &DetectorContext<'_>, from: &str, to: &str) -> bool {
    let path = ctx.vault_root.join(from);
    let Ok(raw) = std::fs::read_to_string(&path) else {
        return false;
    };
    let target_base = base_name(to).to_lowercase();
    let parsed = crate::core::parser::parse_note(&raw);
    parsed.wikilinks.iter().any(|wl| {
        // Strip an optional `#heading` anchor and `.md`, compare base names.
        let t = wl.target.split('#').next().unwrap_or(&wl.target);
        base_name(t).to_lowercase() == target_base
    })
}

/// File stem without directory or `.md` extension: "Projects/Feast.md" → "Feast".
pub fn base_name(path: &str) -> String {
    let no_dir = path.rsplit('/').next().unwrap_or(path);
    no_dir
        .strip_suffix(".md")
        .unwrap_or(no_dir)
        .to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base_name_strips_dir_and_ext() {
        assert_eq!(base_name("Projects/Feast.md"), "Feast");
        assert_eq!(base_name("flat.md"), "flat");
        assert_eq!(base_name("no-ext"), "no-ext");
    }
}
