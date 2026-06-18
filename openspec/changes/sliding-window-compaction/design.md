# Design: Sliding-Window Compaction

## Context

The current compaction path lives in `packages/core/src/session/compaction.ts`. Its `compactIfNeeded` checks whether the request exceeds `context - max(output, buffer)` and, on overflow, calls `compactAfterOverflow`, which uses `select()` to hard-cut older history and `buildPrompt()` to produce a single anchored summary. The summary is regenerated on every overflow, even when the older history has not changed, and the cut is biased toward keeping only a fixed recent-token slice.

Two pieces of evidence motivate a different shape. First, the "lost in the middle" effect: transformer models recall information at the start and especially the end of the context far better than the middle, so keeping the recent TAIL verbatim exploits the high-recall recency zone. Second, a production eval at Factory over roughly 36k messages found that retaining slightly more tokens scored higher than over-compressing, which argues for a generous TAIL and against setting `tail_ratio` too low.

Config schema lives in `packages/core/src/config/compaction.ts` (Effect `Schema.Class`). Env flags follow the `Flag.OPENCODE_EXPERIMENTAL_*` pattern already used in `packages/core/src/filesystem/watcher.ts`. TUI surfaces are `packages/tui/src/component/dialog-status.tsx` and `packages/tui/src/feature-plugins/sidebar/context.tsx`.

Note on config surface: unlike the sibling context capabilities which gate on `experimental.*` flags, this change gates on `compaction.sliding_window.*` plus an env var. Aligning these surfaces (or documenting why they differ) is part of the shared config work, since the `Experimental` schema in `packages/core/src/config/experimental.ts` currently exposes only `policies` and must be extended before any of the sibling `experimental.*` flags resolve.

## Goals / Non-Goals

Goals:
- Add an opt-in rolling-window strategy: summarized HEAD plus verbatim TAIL.
- Cache the HEAD summary by session id and head boundary; regenerate only when the head changes.
- Cap the budget when the TAIL would span the whole context.
- Track and surface per-session token savings in the TUI.
- Keep the legacy hard-truncation path as the default and fallback.

Non-Goals:
- Replacing or removing the existing hard-truncation path.
- Changing the summary template or the LLM summarization prompt structure.
- Persisting the summary cache across process restarts (in-memory, per session, is sufficient for v1).
- Multi-session global savings analytics beyond per-session display.

## Decisions

### Cache key design
Key the summary on `(sessionID, headBoundary)`. The head boundary is the identity of the last message included in the HEAD (its sequence number plus a content hash of the serialized head, so that edits to existing head messages also invalidate the entry). Including `sessionID` prevents cross-session collisions when two sessions reach structurally similar heads. An in-memory `Map<string, string>` keyed by `sessionID + ":" + headBoundaryHash` is the simplest store that satisfies the regeneration-only-when-head-changes requirement.

### Where it hooks into the existing compaction path
Branch inside `compactIfNeeded` (or a sibling entry point) in `packages/core/src/session/compaction.ts`: when the strategy is enabled (config `enabled` OR `OPENCODE_EXPERIMENTAL_SLIDING_WINDOW`) and the estimate exceeds `threshold`, run the sliding-window splitter and cache-aware summarizer; otherwise fall through to the existing `compactAfterOverflow`. Reuse `serialize()`, `buildPrompt()`, and the existing streaming summarization call so only the selection, caching, and budget logic are new.

Sliding-window is one of the mutually-exclusive summarizing strategies governed by the `context-safety-net` "Compaction pipeline order" requirement. When both capabilities are enabled, sliding-window is the single summarizing strategy for a request: the legacy hard-truncation path and the Tier 2 micro-compaction path MUST NOT also summarize the same prepared request. The splitter's HEAD/TAIL cut MUST keep every tool-call/tool-result pair on one side so the summarized HEAD never orphans a tool result left verbatim in the TAIL.

### Default threshold / tail_ratio
`threshold` defaults to 50000 tokens and `tail_ratio` defaults to 0.5. These mirror the ported values and align with the Factory evidence favoring a generous tail. `enabled` defaults to false so the feature is strictly opt-in.

### Alternatives considered
- Hard truncation (current behavior): simplest, but discards recent verbatim detail and re-summarizes unchanged history every overflow. Kept as the default fallback rather than the primary path.
- Full-history summarization: summarize everything into one block. Maximizes token reduction but destroys the recency zone the model relies on and contradicts the "retain slightly more" eval finding. Rejected as the primary strategy.

## Risks / Trade-offs

- [Risk] The HEAD summary loses critical detail that later turns depend on. Mitigation: keep a generous verbatim TAIL (default `tail_ratio` 0.5), reuse the structured summary template that preserves files, commands, and identifiers, and update rather than discard the prior summary when the head grows.
- [Risk] `tail_ratio` set too low over-compresses and degrades quality, contradicting the Factory eval. Mitigation: default to 0.5, document the evidence in config comments, and consider a soft lower bound or warning for very low values.
- [Risk] Budget cap trims the TAIL and silently drops recent messages. Mitigation: cap to total-context-minus-MIN deterministically, log when trimming occurs, and ensure the summary still covers what was trimmed.
- [Risk] Cache returns a stale summary after a head edit. Mitigation: include a content hash of the serialized head in the cache key so any head change invalidates the entry.
- [Risk] Token-savings accounting drifts from real provider usage. Mitigation: compute savings from the same `Token.estimate` used for budgeting and label the value as an estimate in the TUI.

## Open Questions

- Should the summary cache persist across restarts, or is per-process in-memory sufficient for v1?
- How should savings be aggregated when both legacy and sliding-window compaction have run in the same session?
- Should `tail_ratio` enforce a hard minimum, or only warn, when configured very low?
- Resolved: the budget cap reserves MIN = `DEFAULT_BUFFER` (20,000 tokens) plus the model output allowance, and trims the TAIL from its oldest end (see the spec requirement "Budget Cap When Tail Spans Full Context").
