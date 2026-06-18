# Design: Orchestration Guardrails

## Context

opencode runs subagents and tool loops with no upper bound on repeated calls, nesting depth, descendant count, or per-model fan-out. Once permissions auto-allow, an agent can loop indefinitely. Real incidents (a 73-identical-call / ~47k-token loop, a $47k recursive runaway, a 658x cost-inflation tool-call attack) all stem from these missing caps. This change ports the opencode-x "orchestration guardrails" feature (canonical commits fe8a88fbb, 9685f9792, 3cee5e0bc, 1a8cdef24) into this monorepo. The integration surfaces are the tool/task execution loop and tool registry under `packages/core/src/tool/`, subagent spawning and the session tree under `packages/core/src/session/` and `packages/core/src/agent.ts`, the LLM dispatch path for per-model concurrency, and the task tool's parameter handling for category/ultrawork routing. Config lives in `packages/core/src/config/experimental.ts` using Effect `Schema.Class` with snake_case keys, matching existing conventions.

## Goals / Non-Goals

**Goals:**

- Add default-on, safely-valued caps that stop loop, depth, descendant, and concurrency runaways without changing behavior for normal sessions.
- Provide a doom-loop hard cap that holds even when permissions auto-allow and even if the configurable loop threshold is raised.
- Add category and ultrawork routing so tasks can be directed to purpose-specific models.
- Add an opt-in parallel-tool-call path that only activates for pre-approved, parallel-safe tools.
- Match existing conventions: immutable data, small focused files, explicit error handling, Bun APIs, snake_case config keys.

**Non-Goals:**

- Near-duplicate / no-progress loop heuristics (exact-hash only here; near-dup is a follow-up).
- Cross-process or distributed concurrency coordination (concurrency is per-process).
- Dynamic learned routing or confidence-based model selection.
- Changing default model behavior when routing config is empty/unset.

## Decisions

- **Loop detection via hashing tool name + args**: each task/tool call is reduced to a stable hash of `toolName` plus canonicalized arguments and pushed into a fixed-size per-session ring buffer. A consecutive-identical counter increments on a matching hash and resets on any differing call. Reaching `loop_detector_threshold` (default `5`) aborts the agent with an explicit error. Hashing keeps the check constant-time and memory-bounded; the ring buffer avoids unbounded history growth. Detection state is held immutably on the session and replaced on each update rather than mutated in place.
- **Doom-loop hard cap**: separate from the configurable threshold, a per-process agent ruleset enforces an absolute stop so a runaway agent halts even when permissions auto-allow and even if `loop_detector_threshold` is raised or disabled. This is the safety floor; loop detection is the tunable layer above it. The cap is a fixed ceiling of `1000` total task/tool calls per root session (counted across the root and all descendants) and is not configurable, so it cannot be raised or disabled.
- **Depth / descendant tracking on the session tree**: each session records its depth (parent depth + 1) and each root session tracks a total descendant counter. A spawn request reads the parent's depth and the root's count of currently-active descendants (incremented on spawn, decremented when a descendant terminates), then rejects with an explicit error if `max_subagent_depth` (default `3`) or `max_subagent_descendants` (default `50`) would be exceeded. The descendant cap therefore bounds concurrent fan-out, not lifetime totals. Counters are updated by producing a new session-tree snapshot, never by mutating shared state.
- **Per-model semaphore**: concurrency is enforced with a semaphore keyed by `providerID:modelID`, sized to `model_concurrency` (default `5`). Calls acquire before dispatch and release after completion; over-cap calls wait for a slot rather than failing, so throughput is shaped, not dropped. Distinct keys hold independent semaphores.
- **Category / ultrawork routing resolution order**: routing resolves in a fixed precedence so it is deterministic. (1) Ultrawork: if the prompt contains `ulw`/`ultrawork` or `use_ultrawork: true` is set and `ultrawork_model` is configured, route there. (2) Category: else if `task_category` maps to an entry in `task_categories`, route to that `{ providerID, modelID }`. (3) Default: else use the default model. Any unset/unmapped routing config falls back to the default model with no error.
- **Default values rationale**: defaults are deliberately generous so normal sessions never hit them: `5` consecutive identical calls is far above legitimate retry patterns, depth `3` covers realistic delegation chains, `50` descendants covers large fan-out work, and `5` concurrent calls per model balances throughput against rate limits. Routing maps default to empty and parallel flags default to `false`, so the feature is inert until explicitly tuned.
- **Alternatives considered**: no caps (status quo) was rejected. It leaves every documented incident (the 47k-token loop, the $47k runaway, the 658x cost attack) unmitigated, and the cost of adding constant-time caps is negligible compared to the downside they prevent.

## Risks / Trade-offs

- [Risk] Caps set too tight could truncate legitimate long-running or deeply-nested work. → Mitigation: defaults are generous (`5` / `3` / `50` / `5`) and every cap is tunable via `experimental.*`, so workloads that genuinely need more headroom can raise them.
- [Risk] Exact-hash loop detection misses "slightly varied query" loops where each call differs trivially. → Mitigation: the doom-loop hard cap still bounds total runaway cost, and a future near-duplicate / no-progress heuristic is noted as the follow-up to catch varied-query loops.
- [Risk] Per-model concurrency queuing could add latency under heavy fan-out. → Mitigation: over-cap calls wait rather than fail, the cap is per-model and tunable, and the default of `5` is chosen to stay within typical provider rate limits.
- [Risk] Parallel tool calls could run unsafe operations concurrently. → Mitigation: parallelism is opt-in and gated so it activates only when every tool in the batch is pre-approved and parallel-safe; anything else falls back to sequential.

## Open Questions

- Should loop-detection hashing canonicalize argument ordering / whitespace, or hash raw serialized args? Canonicalization catches more loops but risks collapsing meaningfully different calls.
- Is the descendant counter scoped strictly to the root session, or should intermediate subtrees also carry sub-limits?
- Resolved: the doom-loop hard cap is a fixed ceiling of `1000` total task/tool calls per root session and is not configurable, so it cannot be raised or disabled (see the spec requirement "Doom-loop hard cap").
- For ultrawork keyword matching, should `ulw`/`ultrawork` match be word-boundary aware to avoid false positives inside larger tokens?
