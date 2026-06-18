# Design: Three-Tier Context Safety Net

## Context

OpenCode prepares each LLM request by projecting session messages into a provider payload (`packages/core/src/session/`, with summarization in `packages/core/src/session/compaction.ts`). Utilization against the model's context window is only ever estimated, not measured: `packages/core/src/util/token.ts` uses a fixed `CHARS_PER_TOKEN = 4` heuristic (`estimate(input) = round(input.length / 4)`). That estimate is good enough on average but wrong often enough that a request can cross the provider's real limit before any proactive guard fires.

The motivation is "context rot": independent testing across 18 current frontier models shows accuracy degrading as input grows, well before the context window is full. So keeping context smaller is a quality goal, not only a survival goal. Today the only guards are a single auto-compaction pass and the provider's hard limit, which makes failure a cliff edge. This change replaces the cliff with a staircase: cheap interventions early, lossy ones only when unavoidable, plus a reactive net for the estimation gap.

## Goals / Non-Goals

Goals:
- Prevent context-window overflow from hard-failing a session.
- Degrade gracefully: the least-lossy intervention that works at each utilization level.
- Keep all behavior opt-in and default-off, with no change when flags are unset.
- Catch the estimation gap reactively so a wrong estimate does not become a dead session.

Non-Goals:
- Replacing the existing auto-compaction; the tiers layer on top of it.
- Improving the token-estimation heuristic itself (tracked as an open question).
- Compressing or routing tool outputs proactively (that is the separate `hybrid-model-routing` capability; this change only reuses its cheap model).
- Reading collapse backups back into a session automatically.

## Decisions

### Threshold ordering and tier responsibility

Tiers run in increasing order of both cost and lossiness, gated on the shared utilization value `input_tokens / context_window`:

1. Tier 1 (Tool Result Budget): always active when configured, independent of utilization. Pure string truncation of the oldest tool results, no model call, the least-lossy intervention, so it runs first and unconditionally.
2. Tier 2 (MicroCompact) at `>= 0.75`: summarizes older messages, keeps the 10 most recent verbatim. One model call, moderately lossy.
3. Tier 3 (Context Collapse) at `>= 0.97`: emergency replacement of all messages with a structured summary plus the last user message, after a full-history disk backup. Most lossy, last resort.

Ordering rationale: each threshold is the point where the next-cheaper tier is no longer sufficient. 0.75 leaves comfortable headroom for one summarization round to land before the next request; 0.97 is the "about to overflow anyway" emergency band where losing fidelity beats losing the session.

### Token-estimation approach and why the reactive 413 path is needed

Utilization uses the existing `Token.estimate` (`chars/4`) over the projected request, consistent with current compaction. This is intentionally kept simple (KISS) rather than adding a per-provider tokenizer, but it is the weakest link: the estimate can under-count, so a request judged at 0.90 may actually be over the real limit. The proactive tiers therefore cannot be trusted as the only guard. The reactive Tier exists precisely to catch that gap: when the provider rejects a request with HTTP 413 "prompt too long", we treat that as ground truth, compact, and retry. The reserve-token floor (default ~20k) ensures the retry targets meaningfully below the window so a second estimation miss does not immediately re-overflow, and a retry cap prevents an estimation-vs-reality loop.

### Where each tier hooks into the request-prep path

All proactive tiers operate on the projected, outbound message list during request preparation, producing a new reduced list (immutable; originals are never mutated in place). Tier 1 runs first as a synchronous transform. Utilization is computed once on the post-Tier-1 list, then Tier 2 and Tier 3 are evaluated against it. Tier 3's disk backup happens before any message removal so the original history is always recoverable from `~/.local/share/opencode/log/collapse/`. The reactive 413 handler wraps the LLM call (in `packages/llm` / the core call site), catching the provider error after the request leaves and looping back through compaction before retry.

### Reuse the cheap model from hybrid routing

Tier 2 (and Tier 3's summarization) prefer the cheap model resolved by the `hybrid-model-routing` capability when it is configured, falling back to the session model otherwise. This avoids duplicating model-selection logic and keeps summarization cheap. When hybrid routing is absent, behavior is identical except the session model does the summarizing.

### Alternatives considered

- Single auto-compact only (status quo, raise the threshold): rejected. One pass at one threshold is the cliff edge we are removing; it cannot both run early enough for quality and aggressively enough for emergencies, and it still has no answer to the estimation gap.
- Per-provider exact tokenizers instead of `chars/4`: rejected for now (YAGNI / KISS). Heavy, provider-specific, and the reactive 413 net already covers the failure mode the estimate cannot.
- Always-on tiers regardless of config: rejected. Lossy interventions must be opt-in so users on small, careful sessions are never silently summarized.

## Risks / Trade-offs

- [Risk] Token mis-estimation (`chars/4`) crosses the real limit before any proactive tier fires. Mitigation: the reactive 413 recovery path treats the provider error as ground truth and compacts/retries with a reserve-token floor; proactive thresholds are set conservatively (0.75 / 0.97) to widen the margin.
- [Risk] Emergency-tier summary loss: Tier 2 and especially Tier 3 discard fidelity, inheriting all summary-loss risk (the model may drop facts the user still needed). Mitigation: Tier 3 always backs up the full history to disk before collapsing so nothing is permanently lost, keeps the last user message verbatim, and falls back to keep-last-4 when summarization fails rather than producing a possibly-empty or corrupt summary.
- [Risk] "Context anxiety": tiers firing too eagerly degrade quality on sessions that were fine, making the agent feel forgetful. Mitigation: all tiers are opt-in and default-off; thresholds leave headroom; Tier 1 (lossless-ish truncation of old tool noise) carries most of the early load before any summarization happens.
- [Trade-off] Extra model calls: Tier 2/3 each add a summarization call when triggered. Mitigated by preferring the cheap model and by Tier 1 needing no model call at all.

## Open Questions

- Should the `chars/4` heuristic be replaced or supplemented with provider-reported usage from the previous turn to make proactive thresholds more accurate?
- Should the reserve-token floor and retry cap be configurable, or are the defaults (~20k, small fixed cap) sufficient?
- Should collapse backups be pruned/rotated, and is there ever a supported flow to restore a session from a backup file?
- Should Tier 1's "keep newest" be smarter than oldest-first (for example, never truncate a tool result the latest assistant message references)?
