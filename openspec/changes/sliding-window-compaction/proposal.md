# Sliding-Window Compaction

## Why

Today's compaction path hard-truncates older history and replaces it with a single anchored summary regenerated on every overflow. This loses recent verbatim detail the model depends on and pays to re-summarize work that has not changed. Production evidence (a Factory eval over ~36k messages) shows that retaining slightly more verbatim context scores higher than over-compressing, and the "lost in the middle" literature shows models have their highest recall in the most recent (tail) region. A rolling window that summarizes only the older HEAD while keeping a verbatim TAIL, and that caches the summary by head boundary, preserves recency-zone recall and avoids redundant summarization cost.

## What Changes

- Add an opt-in sliding-window compaction strategy that splits history into a summarized HEAD (older messages) and a verbatim TAIL (recent messages) instead of hard-truncating.
- Split the HEAD/TAIL boundary by a configurable `tail_ratio`, with cut points allowed at any message boundary (not only user-message boundaries).
- Cache the generated summary keyed by session id plus the head boundary, and regenerate the summary only when the head changes.
- Cap the budget to total-context-minus-MIN when the verbatim tail would otherwise span the entire context window.
- Track per-session token savings produced by the strategy and surface them in the TUI `/status` dialog and the sidebar context panel.
- Add `compaction.sliding_window` config (`enabled`, `threshold`, `tail_ratio`) and an `OPENCODE_EXPERIMENTAL_SLIDING_WINDOW=1` env-var enable.
- Default off. No change to existing behavior unless explicitly enabled. Not **BREAKING**.

## Capabilities

### New Capabilities

- `sliding-window-compaction`: A rolling-window compaction strategy that summarizes an older HEAD and keeps a verbatim TAIL, caches the summary by session id and head boundary, regenerates only when the head changes, caps the budget when the tail spans the full context, and reports per-session token savings to the TUI.

### Modified Capabilities

None — opt-in, default off.

## Impact

- Affected code: `packages/core/src/config/compaction.ts` (config schema), `packages/core/src/session/compaction.ts` (strategy + cache + budget), `packages/core/src/flag` (env var), `packages/tui/src/component/dialog-status.tsx` and `packages/tui/src/feature-plugins/sidebar/context.tsx` (savings display).
- Affected users: only those who opt in via config or env var; all others keep the existing hard-truncation path.
- Risk surface: contained behind a feature flag and a default-false config key, so the legacy path remains the default and fallback.
