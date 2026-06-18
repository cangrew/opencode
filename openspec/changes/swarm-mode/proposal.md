# Swarm Mode (Batch-Parallel Subagent Execution)

## Why

Some work is naturally fan-out: review N files, analyze N items, classify N records. Doing this with the existing single-target `task` tool forces the orchestrator to issue one tool call per item, which is slow, verbose, and easy to get wrong (forgotten items, drifting prompts, manual result stitching). A batch-parallel primitive lets the LLM express "run this same prompt template over these N items, in parallel" as a single tool call, then receive a clean structured result it can reason over.

Evidence is mixed and bounds the scope: parallel fan-out shows roughly 90% wall-clock gains on read-heavy independent work, but costs about 15x the tokens of a single agent and is fragile for write-heavy coding with shared state. So swarm is positioned for read-heavy, independent, parallel tasks where each item is self-contained. Parallel writes to overlapping code are explicitly out of scope and must use isolation (e.g. worktrees) instead.

The capability is being ported from the opencode-x fork (canonical commit a117307d7), where it exists as a `swarm` tool plus a `/swarm` slash command.

## What Changes

- Add an opt-in `experimental.swarm` config flag (default `false`) plus `experimental.swarm_max_items` (default `20`) and `experimental.swarm_concurrency` (default `5`) bounds.
- Add a `SwarmTool` exposed to the LLM only when `experimental.swarm` is enabled. It accepts a prompt `template` with `{{placeholder}}` markers and an `items` array; each item (`{ id, ...placeholders }`) spawns an independent subagent session.
- Expand the template per item, substituting `{{placeholder}}` markers from each item's key/value fields, and dispatch the resulting prompts in parallel up to a concurrency limit (default `5`, capped at `20`).
- Enforce the `swarm_max_items` cap on the number of items and the `1-20` concurrency range on the `concurrency` parameter.
- Collect per-item results and return them as structured XML: `<swarm_results>` containing one `<item id=".." status="completed|error" duration_ms="..">` per item.
- Support two execution modes: foreground (blocks until all items complete, returns full results) and background (`background=true` returns immediately with an acknowledgment, then injects the aggregated results into the conversation when all items complete).
- Isolate per-item failures: an individual item failing yields `status="error"` for that item only and never aborts the swarm.
- Prevent recursion: swarm subagents cannot spawn their own subagents or swarms (no nested `task`/`swarm`).
- Add a server-side `/swarm` slash command, gated on `experimental.swarm`.
- **BREAKING**: none. The feature is opt-in and default-off; with `experimental.swarm` unset, no tool, command, or behavior changes.

## Capabilities

### New Capabilities

- `swarm-execution`: batch-parallel subagent execution driven by a prompt template and an items array, with concurrency-limited dispatch, structured-XML aggregation, foreground/background modes, per-item failure isolation, and a no-recursion guard. Exposed as a `SwarmTool` and a `/swarm` command, both gated on `experimental.swarm`.

### Modified Capabilities

None — opt-in, default off.

## Impact

- **Packages**: `packages/core` (config schema for `experimental.swarm*`, `SwarmTool` definition and registration in the tool registry, template expansion, concurrency-limited dispatch reusing existing subagent/task spawning infra, result aggregation, background injection, recursion guard); `packages/opencode` (the `/swarm` server-side slash command and its gating).
- **Config**: new `experimental.swarm` (default `false`), `experimental.swarm_max_items` (default `20`), `experimental.swarm_concurrency` (default `5`).
- **Runtime**: when enabled and invoked, up to `concurrency` subagent sessions run in parallel per swarm; token usage scales with item count (about 15x a single agent for large fan-outs), bounded by `swarm_max_items`.
- **Reused infra**: subagent/session spawning and the background-job + result-injection mechanism already used by the `task` tool; no new provider integrations.
