# Spec: Quick-note auto-filing — "the note that files itself"

**Status:** draft
**Depends on:** Insights engine (Phase 1, shipped), embedding index (MVP-2, shipped)
**Owner modules:** `src-tauri/src/core/ai/insights/`, `src-tauri/src/commands/`, `src/components/insights/`

## 1. Problem

Quick capture (`⌘/Ctrl+Shift+N`) is Mycel's strongest on-ramp: a thought
becomes a file in `quick/YYYY-MM-DD/HH-MM-SS.md` in under a second. But
nothing ever takes those files *out*. The quick folder grows into a
write-only graveyard, and the user's real notes never benefit from the
captured thoughts. Every PKM tool has this problem; none solves it well.

## 2. The feature in one sentence

After you capture a quick note, Mycel figures out where it belongs and
offers — as an Insights card — to file it there with one click: merge it
into the related note (with a wikilink and provenance), or send it to the
Garden inbox if it reads like a task.

The user never loses control: nothing is written or deleted without an
explicit confirmation. This matches the existing Insights contract
("detectors don't write; actions are gated by UI confirmation").

## 3. Goals / non-goals

**Goals (v1):**

- A new detector, `quick_note_filing`, that runs on the existing daily
  schedule and on "Run now", producing at most one card per quick note.
- Two new resolving actions: merge-into-note and send-to-Garden-inbox.
- The merge is performed atomically in Rust (not through the editor
  buffer), preserves full content, and leaves a provenance trail.
- Zero new API costs: the detector rides the existing embedding index,
  `requires_llm()` stays `false`.

**Non-goals (v1, explicitly deferred):**

- LLM-generated titles/summaries or target-section selection (v3).
- Near-real-time "filed a minute after capture" trigger (v2 — the daily
  run ships first because all its plumbing already exists).
- Filing arbitrary non-quick notes (could later generalize via a
  `filing_roots` setting; v1 hardcodes `QUICK_NOTES_DIR`).
- Auto-filing without confirmation. Never in any version.

## 4. UX

### 4.1 The card

A new `InsightKind::QuickNoteFiling` (key `quick_note_filing`) renders in
the existing Insights inbox (`InsightCard.tsx`, new `KIND_META` entry,
icon: `FolderInput`).

Merge suggestion:

> **File quick note → Garden plans**
> This quick note from May 12 looks like it belongs in [[Garden plans]].
> Merge it there and clear it from your quick folder?
>
> *…first ~200 chars of the quick note…*
>
> `[Merge into note]` `[Open both]` `[✕]`

Task suggestion:

> **Quick note looks like a task**
> "Call the nursery about apple saplings" reads like a to-do. Send it to
> your Garden inbox?
>
> `[Send to Garden inbox]` `[Open]` `[✕]`

### 4.2 Confirmation dialogs

- **Merge** opens a dialog showing: source content (full), target note
  name, the exact section that will be appended, and a checkbox
  "Delete the quick note after merging" (default: checked, persisted as
  a setting). Confirm → backend command → card marked acted.
- **Send to Garden inbox** opens a small dialog with the captured text
  (editable, pre-filled with the note body), same delete-after checkbox.

Both follow the `ResolveDuplicateDialog` pattern: the insight is only
marked `acted` after the backend confirms the write.

### 4.3 Dismiss semantics

Dismiss uses the standard cooldown (default 14 days). The stable id is
`stable_id("quick_note_filing", [quick_path], [target_path])`, so:

- Dismissing "file X into A" does not suppress a later, better
  suggestion "file X into B".
- The same (X, A) pair won't return until the cooldown expires, even if
  X is edited.

## 5. Detector design

New file: `src-tauri/src/core/ai/insights/detectors/quick_filing.rs`,
registered in `insights::default_detectors()`. `enabled_by_default() =
true` (it is suggestion-only and quota-capped), `requires_llm() = false`.

### 5.1 Candidate selection

A quick note is a candidate when ALL of:

- path is under `quick/` (the Rust-side constant must match
  `QUICK_NOTES_DIR` in `src/types`);
- plain `.md` (skip `.md.age` — encrypted notes are never read);
- non-empty after stripping frontmatter and whitespace;
- last modified ≥ `quick_filing_min_age_minutes` ago (default 30) — we
  don't file a thought the user is still typing;
- no `filed_to:` frontmatter key (set when a merge keeps the original);
- indexed (has rows in `chunks`). The scheduler already bulk-reindexes
  before each run, so by detector time every saved quick note has
  embeddings. If a candidate has no chunks (e.g. AI was off when it was
  saved), skip it this run — do NOT call OpenRouter from the detector.

Note: `similar_notes_min_words` does NOT apply here. Quick notes are
short by nature; the existing word gate would exclude the entire
feature's input. Noise is controlled by the similarity threshold and
quotas instead.

### 5.2 Target ranking (merge suggestion)

For each candidate, reuse `related::find_related(store, path, K)` with
K = 8, then filter hits:

- drop targets under `quick/` (never merge one fleeting note into
  another);
- drop `.md.age` targets;
- drop targets the quick note already wikilinks to (reuse the
  `already_linked` helper from `similar_notes.rs` — extract it into a
  shared module rather than copying);
- convert distance → similarity with the same `1 - d/2` mapping;
- keep hits with similarity ≥ `quick_filing_min_similarity` (default
  60, stored 0–100 like the similar-notes knobs; quick notes are short,
  so their centroids are noisier than full notes — hence a lower default
  than similar-notes' 70).

Emit at most ONE merge card per quick note: the top surviving hit.
`confidence` = similarity, so the engine's existing ranking naturally
prefers confident filings when the per-kind quota bites.

### 5.3 Task heuristic (Garden suggestion)

v1 keeps this deliberately dumb and language-neutral. A candidate is
task-like when its body (frontmatter stripped) matches any of:

- contains a GFM checkbox (`- [ ]` / `- [x]`);
- contains a `#todo` or `#task` tag;
- first non-empty line ends with `!` and is ≤ 80 chars *and* the note is
  a single line (a barked imperative).

Task-likeness produces a Garden card with `confidence = 0.55` (fixed —
deliberately below typical merge similarities so merge suggestions
out-rank task guesses). If a note is BOTH task-like and has a strong
merge target, emit only the merge card: the content survives either
way, and one card per note is the rule. v3's LLM classifier replaces
this heuristic wholesale.

### 5.4 Insight construction

```rust
// merge card
Insight {
    id: stable_id("quick_note_filing", &[quick_path], &[&target_path]),
    kind: InsightKind::QuickNoteFiling,
    confidence: similarity,
    title: format!("File quick note → {}", base_name(&target_path)),
    body: ...,                          // first ~200 chars as preview
    note_paths: vec![quick_path, target_path],
    actions: vec![
        InsightAction::MergeQuickNote { source, target },
        InsightAction::OpenSideBySide { note_paths },
    ],
    ..
}

// garden card
Insight {
    id: stable_id("quick_note_filing", &[quick_path], &["garden"]),
    ...
    actions: vec![
        InsightAction::SendToGardenInbox { source, text },
        InsightAction::OpenNote { note_path: source },
    ],
}
```

The `"garden"` key-field keeps garden-suggestion ids distinct from any
merge suggestion for the same note (different `note_paths` set already
guarantees distinct signatures, but the explicit field makes it
self-documenting).

## 6. New wire types

`models.rs` gains one `InsightKind` variant (`QuickNoteFiling`,
key `"quick_note_filing"`) and two `InsightAction` variants:

```rust
/// Append the full content of `source` to `target` as a dated section,
/// add a wikilink trail, and (by user choice) delete `source`. The UI
/// MUST show a confirmation dialog with a preview before invoking the
/// merge command — this action deletes a file when the user opts in.
MergeQuickNote { source: String, target: String },

/// Capture `text` into the Garden inbox. `source` is the quick note the
/// text came from; the UI offers to delete it after capture.
SendToGardenInbox { source: String, text: String },
```

## 7. The merge command (backend)

The merge must NOT go through `appendToEditor` (the retry-loop hack used
for wikilinks): the target may not be open, and a half-failed merge that
already deleted the source would lose data. New Tauri command in
`commands/notes.rs`:

```rust
#[tauri::command]
pub async fn quick_note_merge(
    source: String,          // vault-relative quick note path
    target: String,          // vault-relative target path
    delete_source: bool,
    state: State<'_, AppState>,
) -> Result<(), String>
```

Semantics, in order — each step only runs if the previous succeeded:

1. Read `source`; strip frontmatter; refuse if empty or if either path
   escapes the vault root (same normalization as existing note commands).
2. Append to `target`:

   ```markdown

   ## Quick note · 2026-06-09 14:32

   <full source body>

   *(filed from `quick/2026-06-09/14-32-08.md`)*
   ```

   The heading timestamp comes from the source filename/path (capture
   time), not merge time. Append via read-modify-write of the file on
   disk; if the target is open in the editor the existing file-watcher
   reload path picks the change up like any external edit.
3. If `delete_source`: delete the source file (reuse `note_delete`'s
   internals). Else: write `filed_to: <target>` into the source's
   frontmatter so the detector skips it forever.
4. Best-effort: re-index `target` (and remove `source` from the index
   when deleted) using the existing single-note indexer plumbing, taking
   the `AiState::indexing` lock. Failure here logs and does not fail the
   merge.

Frontend (`InsightCard.tsx`): `merge_quick_note` action → confirmation
dialog → `invoke('quick_note_merge', …)` → `act(insight.id)` → if the
source was open in a tab, close it; open the target.

`send_to_garden_inbox` needs no new backend: it calls the existing
`garden_inbox_capture(text)`, then optionally `note_delete(source)`.
(Optional polish: extend capture to set `InboxItem.source =
"quick_filing"` and `page = source` for traceability — both fields
already exist on the struct.)

## 8. Settings

`InsightsSettings` gains three knobs (serde defaults, same pattern as
the `similar_notes_*` group):

| Field | Default | Meaning |
|---|---|---|
| `quick_filing_min_similarity: u32` | 60 | 0–100 gate for merge suggestions |
| `quick_filing_min_age_minutes: u32` | 30 | don't suggest filing fresh notes |
| `quick_filing_delete_after_merge: bool` | true | default state of the dialog checkbox |

The per-detector on/off toggle is free: the Settings panel auto-renders
it once `insights_settings_get` lists `quick_note_filing`. The two
numeric knobs get sliders next to the existing similar-notes knobs.

## 9. Phase plan

**Phase A — ship the loop (this spec, v1).**
Kind + actions + detector + merge command + dialogs + settings + tests.
Runs on the daily schedule and "Run now". This alone empties the quick
folder and is demoable.

**Phase B — the magic moment (v2).**
Debounced near-real-time trigger: when the file watcher sees a save
under `quick/` and the file then stays untouched for ~90s, run *only*
the `quick_filing` detector for *only* that path (new
`InsightsEngine::run_detector_for_note(name, path)` entry point — index
the single note first, budget-checked, then run with a filtered
candidate set). Surface the result as a toast ("Quick note filed?
[Review]") in addition to the inbox card. Quotas and cooldowns apply
unchanged. This is the 15-second demo video: hotkey → type → toast →
one click → the note lands in the right place.

**Phase C — LLM polish (v3).**
Requires adding chat completions to `openrouter.rs` (it only does
embeddings today). When `ctx.has_llm`:
- classify {reference / task / ephemeral} instead of the §5.3 heuristic;
- suggest which *section* of the target to merge under, and a cleaned-up
  heading instead of the timestamp;
- propose 1–3 tags for unfileable notes ("nothing similar in the vault")
  so even orphans get organized.
Detector stays `requires_llm() = false`; LLM is an enhancement path
inside `run`, never a requirement.

## 10. Edge cases

- **Quick note edited after suggestion, before accept:** the merge
  command re-reads the file at accept time, so the merged content is
  always current. The preview dialog shows current content too.
- **Target deleted between suggestion and accept:** merge command fails
  with a clear error; card stays pending; next run re-evaluates.
- **Both notes are the user's daily-note workflow:** users who *want*
  quick notes to stay put toggle the detector off — one switch, already
  auto-rendered.
- **Vault synced from another device mid-run:** detector reads are
  point-in-time; a stale suggestion fails or no-ops at accept time
  (re-read on accept is the guard).
- **Huge quick note (pasted article):** merge is content-size-agnostic;
  the preview dialog scrolls. No special casing in v1.

## 11. Testing

Unit tests mirror `similar_notes.rs`'s setup (TempDir + `StubEmbedder` +
`indexer::index_note`):

- candidate filtering: non-quick paths, empty notes, `.age`, too-fresh
  (mtime), `filed_to:` frontmatter — all skipped;
- top-1 merge target above threshold → one card with both actions;
- below threshold → no card; already-wikilinked target → no card;
- checkbox body → garden card; checkbox body *with* strong merge target
  → merge card only;
- stable id across runs; id differs per target;
- `quick_note_merge`: appends section with provenance, deletes source
  when asked, writes `filed_to` when not, refuses path escapes, refuses
  empty source.

Telemetry needs no new work: the existing acceptance report
(`acted / shown` per detector) is exactly the success metric. Target:
≥ 30% acceptance; below ~10% means the threshold defaults are wrong.

## 12. Open questions

1. Should "Run now" in the Insights panel get a sibling "File my quick
   notes" button somewhere near the quick folder in the sidebar? (Pure
   UI affordance; engine call is the same.)
2. Merge heading format: `## Quick note · <timestamp>` vs. first line of
   the note as heading. v1 uses the timestamp (deterministic, no
   truncation games); v3's LLM can do better.
3. After several merges a target accumulates `## Quick note · …`
   sections. Acceptable for v1; v3 section-targeting addresses it.
