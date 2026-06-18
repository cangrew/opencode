# Tasks: Orchestration Guardrails

## 1. Config schema

- [ ] 1.1 Add `loop_detector_threshold` (number, default `5`) to the `Experimental` schema in `packages/core/src/config/experimental.ts`.
- [ ] 1.2 Add `max_subagent_depth` (number, default `3`) and `max_subagent_descendants` (number, default `50`).
- [ ] 1.3 Add `model_concurrency` (number, default `5`).
- [ ] 1.4 Add `task_categories` (map of name to `{ providerID, modelID }`, default empty) and `ultrawork_model` (optional `{ providerID, modelID }`).
- [ ] 1.5 Add `parallel_tool_calls` (boolean, default `false`) and `parallel_read` (boolean, default `false`); validate that `parallel_read` requires `parallel_tool_calls`.
- [ ] 1.6 Keep all keys snake_case and Effect `Schema.Class`-based; ensure defaults are applied so absent config behaves identically to today.

## 2. Loop detector

- [ ] 2.1 Implement a stable hash of tool name plus canonicalized arguments for each task/tool call.
- [ ] 2.2 Maintain a fixed-size per-session ring buffer of recent call hashes with an immutable consecutive-identical counter.
- [ ] 2.3 Increment the counter on a matching hash and reset it on any differing call.
- [ ] 2.4 Abort the agent with an explicit loop-detected error when the counter reaches `loop_detector_threshold`, without executing the repeated call.

## 3. Doom-loop hard cap

- [ ] 3.1 Implement a per-process agent ruleset that enforces an absolute stop on runaway loops: a fixed, non-configurable ceiling of `1000` total task/tool calls per root session, counted across the root and all descendants.
- [ ] 3.2 Ensure the hard cap fires even when permissions auto-allow every call.
- [ ] 3.3 Ensure the hard cap operates independently of `loop_detector_threshold` (still stops when the threshold is raised or disabled).

## 4. Spawn depth and descendant tracking

- [ ] 4.1 Record each session's depth as parent depth + 1 on the session tree.
- [ ] 4.2 Track a count of currently-active descendants per root session (incremented on spawn, decremented when a descendant reaches a terminal state), updated immutably.
- [ ] 4.3 Reject spawns that would exceed `max_subagent_depth` with an explicit depth-exceeded error.
- [ ] 4.4 Reject spawns that would exceed `max_subagent_descendants` with an explicit descendant-cap error.

## 5. Per-model concurrency

- [ ] 5.1 Implement a semaphore keyed by `providerID:modelID`, sized to `model_concurrency`.
- [ ] 5.2 Acquire a slot before LLM dispatch and release it after completion (including on error).
- [ ] 5.3 Queue over-cap calls until a slot frees rather than failing them; ensure distinct keys hold independent semaphores.

## 6. Category routing

- [ ] 6.1 Add/confirm the task tool's `task_category` parameter.
- [ ] 6.2 Resolve `task_category` against `experimental.task_categories` to a `{ providerID, modelID }`.
- [ ] 6.3 Fall back to the default model with no error when the category is unset or unmapped.

## 7. Ultrawork routing

- [ ] 7.1 Detect `ulw`/`ultrawork` in the task prompt and the `use_ultrawork: true` flag.
- [ ] 7.2 Route to `experimental.ultrawork_model` when ultrawork is requested and configured.
- [ ] 7.3 Fall back to the default model with no error when `ultrawork_model` is unset.
- [ ] 7.4 Apply routing precedence: ultrawork over category over default.

## 8. Parallel-tool-call safety gate

- [ ] 8.1 Gate parallel execution on `parallel_tool_calls` being enabled.
- [ ] 8.2 Allow parallel execution only when every tool in the batch is pre-approved and parallel-safe; otherwise run sequentially.
- [ ] 8.3 Let the read tool join parallel execution only when `parallel_read` is enabled and `parallel_tool_calls` is also enabled.
- [ ] 8.4 Keep execution sequential under default config (`parallel_tool_calls` and `parallel_read` both `false`).

## 9. Unit tests

- [ ] 9.1 Loop detector: threshold abort, counter reset on differing calls, configurable threshold.
- [ ] 9.2 Doom-loop hard cap: fires under auto-allow permissions and when the threshold is raised/disabled.
- [ ] 9.3 Depth limit: spawn within limit succeeds, spawn at limit rejected.
- [ ] 9.4 Descendant cap: spawn within cap succeeds, spawn at cap rejected, and a completed descendant frees a slot for a subsequent spawn.
- [ ] 9.5 Per-model concurrency: cap enforced per key, independent pools per distinct key.
- [ ] 9.6 Category routing: mapped category routes, unmapped falls back.
- [ ] 9.7 Ultrawork routing: keyword trigger, flag trigger, unset fallback, precedence over category.
- [ ] 9.8 Parallel gate: parallel for safe pre-approved batch, sequential for unsafe/unapproved, parallel_read requires parallel_tool_calls, sequential by default.

## 10. Integration test

- [ ] 10.1 Drive a session that loops, nests deeply, and fans out beyond every cap, asserting each guardrail aborts/rejects with the correct explicit error and that a normal session under default config is unaffected.

## 11. Docs

- [ ] 11.1 Document all new `experimental.*` flags, their defaults, and routing precedence in the config reference under `packages/opencode`.
- [ ] 11.2 Note the exact-hash limitation and the near-duplicate / no-progress heuristic as a planned follow-up.
