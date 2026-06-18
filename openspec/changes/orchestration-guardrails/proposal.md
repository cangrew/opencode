# Orchestration Guardrails

## Why

Unbounded subagent/task execution and tool loops are the highest-utility, lowest-risk failure mode to fix: documented incidents include a 73-identical-call loop burning roughly 47k tokens, a $47k recursive runaway loop, and a 658x cost-inflation tool-call attack. The common thread is that nothing caps repeated calls, nesting depth, descendant count, or per-model fan-out, and once permissions auto-allow there is no hard stop. Cheap, default-on caps prevent all of these at negligible cost to legitimate work. This change ports the opencode-x "orchestration guardrails" feature (canonical commits fe8a88fbb, 9685f9792, 3cee5e0bc, 1a8cdef24) into this monorepo. Caveat: exact-hash loop detection catches identical repeats but misses "slightly varied query" loops, so near-duplicate / no-progress heuristics are noted as a follow-up rather than included here.

## What Changes

- Add loop detection that hashes each task/tool call (tool name + arguments) into a per-session ring buffer and aborts the agent after `experimental.loop_detector_threshold` consecutive identical calls (default `5`).
- Add a doom-loop hard cap: a per-process agent ruleset that stops infinite loops even when permissions auto-allow, independent of the configurable loop threshold.
- Add spawn depth limiting via `experimental.max_subagent_depth` (default `3`): subagents may not nest deeper than the configured depth.
- Add a descendant cap via `experimental.max_subagent_descendants` (default `50`): a single root session may not spawn more than the configured total number of descendant subagents.
- Add per-model concurrency limiting via `experimental.model_concurrency` (default `5`): at most that many in-flight calls per `providerID:modelID` key.
- Add category routing via `experimental.task_categories`, mapping a `task_category` name to a provider/model; the task tool's `task_category` parameter selects the mapped model.
- Add ultrawork routing via `experimental.ultrawork_model`, used when a task prompt contains `ulw`/`ultrawork` or `use_ultrawork: true` is set.
- Add safe parallel tool calls via `experimental.parallel_tool_calls` (only when all active tools are pre-approved and parallel-safe) and `experimental.parallel_read` (read tool participates in parallel, requires `parallel_tool_calls`).
- No **BREAKING** changes: every flag defaults to a safe value (caps generous, routing/parallel features off), so existing sessions behave identically until explicitly tuned.

## Capabilities

### New Capabilities

- `orchestration-guardrails`: bounds subagent and tool-loop execution with loop detection, a doom-loop hard cap, spawn depth and descendant limits, per-model concurrency, category and ultrawork routing, and a safe parallel-tool-call gate, all driven by `experimental.*` config with safe defaults.

### Modified Capabilities

None.

## Impact

- **Packages**: `packages/core` (config schema in `src/config/experimental.ts`, tool/task execution loop and registry under `src/tool/`, subagent spawn and session-tree tracking under `src/session/` and `src/agent.ts`, per-model concurrency on the LLM dispatch path), `packages/opencode` (config reference/docs surfacing).
- **Config**: new `experimental` keys: `loop_detector_threshold` (default `5`), `max_subagent_depth` (default `3`), `max_subagent_descendants` (default `50`), `model_concurrency` (default `5`), `task_categories` (map of name to `{ providerID, modelID }`, default empty), `ultrawork_model` (`{ providerID, modelID }`, optional), `parallel_tool_calls` (default `false`), `parallel_read` (default `false`).
- **Runtime**: small constant-time overhead per tool/task call (hash + ring-buffer compare, counter checks, semaphore acquire/release). No new provider integrations.
- **Behavior**: agents may now be aborted by loop detection or the doom-loop cap, and subagent spawns may be rejected when depth/descendant caps are hit; these are surfaced as explicit errors, never silent.
