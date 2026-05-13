//! Fixed sliding-window chunker.
//!
//! Spec: 1000 chars per chunk, 100 chars overlap. We chose this over
//! markdown-aware splitting because:
//!   - Zero edge cases. No headings → empty chunks, no code-fence regex
//!     that breaks on nested fences, no list-renumber surprises.
//!   - The embedding model doesn't care about structure; it cares about
//!     enough surrounding context to disambiguate. 100 chars of overlap is
//!     enough that a sentence broken at a window boundary still appears
//!     fully inside an adjacent chunk.
//!
//! Counted in `char`s, not bytes. UTF-8 splits at byte boundaries would
//! corrupt multi-byte glyphs and break the embeddings API on first call.

const WINDOW: usize = 1000;
const OVERLAP: usize = 100;
const STEP: usize = WINDOW - OVERLAP;

pub fn chunk(text: &str) -> Vec<String> {
    let chars: Vec<char> = text.chars().collect();
    if chars.is_empty() {
        return Vec::new();
    }
    let mut out = Vec::new();
    let mut start = 0;
    while start < chars.len() {
        let end = (start + WINDOW).min(chars.len());
        out.push(chars[start..end].iter().collect());
        if end == chars.len() {
            break;
        }
        start += STEP;
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_input_yields_no_chunks() {
        assert!(chunk("").is_empty());
    }

    #[test]
    fn short_input_yields_single_chunk() {
        let s = "hello world";
        let chunks = chunk(s);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0], s);
    }

    #[test]
    fn exact_window_yields_single_chunk() {
        let s = "x".repeat(WINDOW);
        let chunks = chunk(&s);
        assert_eq!(chunks.len(), 1);
        assert_eq!(chunks[0].chars().count(), WINDOW);
    }

    #[test]
    fn one_over_window_yields_two_chunks_with_overlap() {
        let s = "x".repeat(WINDOW + 1);
        let chunks = chunk(&s);
        assert_eq!(chunks.len(), 2);
        // Second chunk starts at STEP (900) and runs to end.
        assert_eq!(chunks[1].chars().count(), WINDOW + 1 - STEP);
    }

    #[test]
    fn long_input_chunks_advance_by_step_and_cap_at_window() {
        // 3000 chars → starts at 0, 900, 1800, 2700 → 4 chunks
        let s = "x".repeat(3000);
        let chunks = chunk(&s);
        assert_eq!(chunks.len(), 4);
        for c in &chunks[..3] {
            assert_eq!(c.chars().count(), WINDOW);
        }
        // Last chunk runs to end of string.
        assert_eq!(chunks[3].chars().count(), 3000 - 2700);
    }

    #[test]
    fn unicode_is_chunked_by_char_not_byte() {
        // Each `я` is 2 bytes but one char; 1500 of them fits in 2 chunks.
        let s = "я".repeat(1500);
        let chunks = chunk(&s);
        assert_eq!(chunks.len(), 2);
        // Splitting at chunk boundary must not corrupt UTF-8.
        for c in &chunks {
            assert!(c.chars().all(|ch| ch == 'я'));
        }
    }

    #[test]
    fn adjacent_chunks_share_overlap_chars() {
        let s: String = (0..2000).map(|i| char::from_u32((b'a' as u32) + (i as u32 % 26)).unwrap()).collect();
        let chunks = chunk(&s);
        assert!(chunks.len() >= 2);
        let tail_of_first: String = chunks[0].chars().rev().take(OVERLAP).collect::<Vec<_>>().into_iter().rev().collect();
        let head_of_second: String = chunks[1].chars().take(OVERLAP).collect();
        assert_eq!(tail_of_first, head_of_second);
    }
}
