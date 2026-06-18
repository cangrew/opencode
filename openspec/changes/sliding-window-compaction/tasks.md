# Tasks: Sliding-Window Compaction

## 1. Config Schema
- [ ] 1.1 Add a `SlidingWindow` Effect `Schema.Class` to `packages/core/src/config/compaction.ts` with `enabled` (boolean, default false), `threshold` (NonNegativeInt, default 50000), and `tail_ratio` (number 0..1, default 0.5).
- [ ] 1.2 Wire `sliding_window` onto the existing `Compaction.Info` class as an optional field.
- [ ] 1.3 Extend the compaction `settings()` reducer in `packages/core/src/session/compaction.ts` to resolve the merged sliding-window settings from config documents.

## 2. Environment Variable
- [ ] 2.1 Add `OPENCODE_EXPERIMENTAL_SLIDING_WINDOW` to the `Flag` module following the existing `OPENCODE_EXPERIMENTAL_*` pattern.
- [ ] 2.2 Treat the strategy as enabled when the config flag OR the env var is set, with the env var taking precedence over a false config value.

## 3. Head/Tail Splitter
- [ ] 3.1 Implement a splitter that divides serialized history into an older HEAD and a recent TAIL targeting `tail_ratio` of the available token budget.
- [ ] 3.2 Allow the cut point to fall at any message boundary, not only user-message boundaries, while keeping each tool-call/tool-result pair wholly on one side of the cut (never orphan a tool result from its call).
- [ ] 3.3 Return the HEAD boundary identity (last-head sequence number plus a content hash of the serialized head) alongside the split.

## 4. Summary Cache
- [ ] 4.1 Add an in-memory cache keyed by `sessionID` plus head-boundary hash, storing the generated HEAD summary.
- [ ] 4.2 On a cache hit, reuse the stored summary and skip the summarization request.
- [ ] 4.3 Ensure distinct sessions never collide on the cache key.

## 5. Regeneration Trigger
- [ ] 5.1 Regenerate the summary only when the head boundary changes; skip regeneration when the boundary is unchanged.
- [ ] 5.2 When the head grows, update the prior summary via the existing `buildPrompt` update path rather than discarding it.

## 6. Budget Cap Logic
- [ ] 6.1 Cap the budget to total-context-minus-MIN when the verbatim TAIL would span the full context window, where MIN = `DEFAULT_BUFFER` (20,000 tokens) plus the model output allowance.
- [ ] 6.2 Trim the TAIL from its oldest end to fit the capped budget, preserving the newest messages verbatim and reserving room for the summary and model output.
- [ ] 6.3 Log when the TAIL is trimmed by the cap.

## 7. Compaction Path Integration
- [ ] 7.1 Branch inside `compactIfNeeded` (or a sibling entry) to run the sliding-window strategy when enabled and the estimate exceeds `threshold`.
- [ ] 7.2 Fall through to the existing `compactAfterOverflow` hard-truncation path when the strategy is disabled.
- [ ] 7.3 Reuse `serialize()`, `buildPrompt()`, and the streaming summarization call; emit the existing compaction Started/Ended events.

## 8. Savings Metrics
- [ ] 8.1 Compute per-session token savings (verbatim estimate minus compacted estimate) using `Token.estimate`.
- [ ] 8.2 Persist or expose the per-session savings so the TUI can read it (event payload or session state).

## 9. TUI Wiring
- [ ] 9.1 Display per-session token savings in `packages/tui/src/component/dialog-status.tsx` (`/status` dialog).
- [ ] 9.2 Display per-session token savings in `packages/tui/src/feature-plugins/sidebar/context.tsx` (sidebar context panel).
- [ ] 9.3 Label the value as an estimate in both surfaces.

## 10. Tests
- [ ] 10.1 Unit: splitter respects `tail_ratio`, cuts at any message boundary, and never splits a tool-call/tool-result pair across the cut.
- [ ] 10.2 Unit: cache key derivation, cache hit reuse, and session isolation.
- [ ] 10.3 Unit: regeneration only when head boundary changes.
- [ ] 10.4 Unit: budget cap trims the TAIL when it spans the full context.
- [ ] 10.5 Unit: threshold gate and env-var/config enable precedence.
- [ ] 10.6 Integration: end-to-end compaction with the strategy enabled produces summarized HEAD plus verbatim TAIL and reports savings.
- [ ] 10.7 Integration: default-off path still uses hard truncation unchanged.

## 11. Docs
- [ ] 11.1 Document `compaction.sliding_window.{enabled,threshold,tail_ratio}` and `OPENCODE_EXPERIMENTAL_SLIDING_WINDOW`.
- [ ] 11.2 Note the "lost in the middle" rationale and the Factory eval guidance that `tail_ratio` should not be set too aggressively low.
