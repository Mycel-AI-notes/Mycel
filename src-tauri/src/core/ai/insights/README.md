# Mycel Insights — Engine

Phase 1 of the AI Insights inbox. Ships **no** detectors of its own — only
the infrastructure that future detectors plug into.

## What's in here

- `models.rs`     — wire types (`Insight`, `InsightKind`, `InsightAction`, …)
- `detector.rs`   — the `Detector` trait + `DetectorContext` + `signature()`
- `store.rs`      — SQLite CRUD for the four `insights_*` tables
- `settings.rs`   — `.mycel/ai/insights.json` (schedule, limits, per-detector toggles)
- `scheduler.rs`  — per-vault tokio task + ranking pipeline (`InsightsEngine`)
- `mock_detector.rs` — debug-only sample detector

## Adding a new detector (Phase 2+ playbook)

1. Add a variant to `InsightKind` and its key string in `InsightKind::as_key`.
2. Create `src-tauri/src/core/ai/insights/detectors/<name>.rs` (a new module).
3. Implement `Detector` for your struct:
   ```rust
   #[async_trait]
   impl Detector for MyDetector {
       fn name(&self) -> &'static str { "missing_wikilink" }
       async fn run(&self, ctx: &DetectorContext<'_>) -> Result<Vec<Insight>> {
           // …read from ctx.store / ctx.vault_root, return insights…
       }
   }
   ```
4. Use `stable_id(kind_key, &note_paths, &key_fields)` for each insight's
   `id`. Re-discovering the same finding must produce the same id — that's
   what makes "dismissed → don't show again" work.
5. Register your detector in `insights::default_detectors()` in `mod.rs`.
6. (Optional) Render a custom icon / label in
   `src/components/insights/InsightCard.tsx`'s `KIND_META` map.

That's it. The scheduler picks up your detector on the next tick (or "Run
now"), the cooldown / quota / telemetry plumbing is automatic, and the
Settings panel auto-renders a toggle as soon as `insights_settings_get`
returns your detector in the `detectors` dict.

## Rules of the contract

- **No filesystem writes.** Detectors get a `&Path` to the vault and a
  read-only `AiStore`. Anything that mutates a note belongs in Phase 4+ and
  goes through an explicit `InsightAction::InsertWikilink` (which is gated
  by a UI confirmation before the write).
- **Stable ids.** Insights re-found on a later run must hash identically.
  Use `stable_id`; do not include timestamps or run-local data.
- **Errors don't poison runs.** Returning `Err` from one detector logs and
  skips that detector. The rest of the run continues.
- **Don't dedupe internally.** The engine filters against the dismissed
  signatures and applies the per-kind / per-day quota. Detectors return
  every interesting finding, ranked by `confidence`.
