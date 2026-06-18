# Three-Tier Context Safety Net

## Why

Every frontier model degrades as input grows ("context rot"): independent testing across 18 current models shows accuracy falling well before the advertised context window is full, not just at the hard limit. OpenCode today relies on a single auto-compaction pass plus the provider's own limit, which is a cliff edge: when an agent's history grows faster than compaction expects, or when our token estimate is wrong, the next request either silently degrades or hard-fails with a provider context-overflow error (HTTP 413, "prompt too long"). The root weakness is estimation: utilization is derived from a `chars/4` heuristic (`packages/core/src/util/token.ts`), so we sometimes cross the real limit before any proactive tier fires.

This change adds a layered, opt-in safety net that degrades gracefully across rising utilization thresholds, plus a reactive recovery path that catches the cases estimation misses. Each tier is the least-lossy intervention that still keeps the session alive at its threshold, so cheap interventions run early and lossy emergency interventions run only when unavoidable.

## What Changes

- Add three opt-in `experimental` config flags (all default off / unset): `experimental.tool_result_budget` (number, character count), `experimental.microcompact` (boolean), `experimental.context_collapse` (boolean).
- Add a shared utilization calculation (`input_tokens / context_window`) used to order and trigger the proactive tiers during request preparation.
- TIER 1 Tool Result Budget: when configured, enforce a global character budget over tool-result outputs in history; when exceeded, replace the oldest tool results with the literal string `[tool result truncated to save context]` until the budget is met.
- TIER 2 MicroCompact: when enabled and utilization reaches `>= 0.75`, summarize older messages while keeping the 10 most recent verbatim, using the cheap model from hybrid routing if configured, else the session model.
- TIER 3 Context Collapse: when enabled and utilization reaches `>= 0.97`, back up the full history to `~/.local/share/opencode/log/collapse/`, then replace all messages with a structured summary plus the last user message; if summarization fails, keep only the last 4 messages.
- Add a REACTIVE recovery path on provider context-overflow (HTTP 413 "prompt too long"): compact and retry with a reserve-token floor (~20k default) to avoid immediate re-overflow, and a capped retry count to avoid loops.
- No **BREAKING** changes: every tier and the reactive path are opt-in. With all flags off/unset, request preparation behaves exactly as it does today.

## Capabilities

### New Capabilities

- `context-safety-net`: a layered set of proactive context-reduction tiers (tool-result budget, micro-compaction at 75%, context collapse at 97%) plus a reactive provider-413 recovery path, each gated by an explicit config flag and a utilization threshold, designed for graceful degradation instead of cliff-edge failure.

### Modified Capabilities

None — opt-in, default off.

## Impact

- **Packages**: `packages/core` (config schema for the three flags, utilization calculation, tier hooks in the request-prep / compaction path under `src/session/`, collapse disk backup, reactive 413 handler on the LLM call path), `packages/opencode` (config reference/docs surfacing).
- **Config**: new `experimental.tool_result_budget` (number of characters, unset = disabled), `experimental.microcompact` (boolean, default `false`), `experimental.context_collapse` (boolean, default `false`).
- **Filesystem**: TIER 3 writes full-history backups under `~/.local/share/opencode/log/collapse/` before replacing messages; backups are append-only and never read back automatically.
- **Runtime**: TIER 2 and TIER 3 each add at most one summarization model call when their threshold is crossed (TIER 2 prefers the cheap model); TIER 1 is pure string manipulation with no model call. The reactive path adds one compaction plus one retry per overflow, bounded by the retry cap.
- **Reuse**: depends on the cheap-model resolution from `hybrid-model-routing` when present; falls back to the session model when hybrid is not configured.
