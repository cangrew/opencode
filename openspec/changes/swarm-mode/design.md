# Swarm Mode Design

## Context

The existing `task` tool (`packages/opencode/src/tool/task.ts`) spawns a single subagent session per call: it resolves an agent, derives child permissions (including denying nested `task` and `todowrite` when the child does not allow them), creates a child session, runs the prompt through `promptOps`, and either blocks (foreground) or registers a background job that injects its result back into the parent conversation when done. Swarm mode generalizes this single-target spawn into a batch-parallel fan-out: one tool call, a prompt template, and an `items` array, with each item driving an independent subagent session.

The motivation and bounds come from observed behavior of parallel fan-out: roughly 90% wall-clock gains on read-heavy independent work, but about 15x token cost and known fragility for write-heavy coding with shared state. Swarm is therefore scoped to read-heavy, independent, parallel tasks (review N files, analyze N items), and is opt-in behind `experimental.swarm`. It is ported from the opencode-x fork (commit a117307d7).

## Goals / Non-Goals

### Goals

- Express batch fan-out as a single LLM tool call: a `template`, an `items` array, an `agent`, a `concurrency` limit, and a `background` flag.
- Run item subagents in parallel up to a bounded concurrency, capped by config.
- Aggregate results into a stable, machine-readable `<swarm_results>` XML envelope with per-item `id`, `status`, and `duration_ms`.
- Support foreground (blocking) and background (deferred injection) modes, reusing the existing background-job + injection mechanism from the `task` tool.
- Isolate per-item failures and prevent recursive swarm/subagent spawning.
- Keep the feature fully opt-in and default-off.

### Non-Goals

- **Parallel writes to shared or overlapping files are out of scope.** Swarm items are independent with no shared state; write-heavy coding across overlapping code is fragile under parallelism and must use isolation (e.g. git worktrees) instead. Swarm will not coordinate, lock, or merge concurrent edits.
- No nested swarms or subagents spawned from within a swarm item (no recursion).
- No cross-item shared state, message passing, or inter-item dependencies.
- No new provider integrations or changes to the LLM call path.
- No automatic retry policy for failed items in this change.

## Decisions

### Concurrency via semaphore

Dispatch is governed by a counting semaphore (Effect `Semaphore`) sized to the resolved `concurrency` (default `experimental.swarm_concurrency`, clamped to `1-20`). Each item acquires a permit before its subagent session runs and releases on completion, so at most `concurrency` sessions are in flight while the rest queue. This reuses Effect's structured concurrency rather than hand-rolling a worker pool.

### Placeholder templating

The `template` string carries `{{placeholder}}` markers. For each item, every `{{key}}` is replaced by the item's matching field value (`item[key]`), with `id` reserved as the item identifier. Templating is a pure string substitution producing one expanded prompt per item; missing keys resolve to an empty string or a validation error (to be finalized, see Open Questions). Keeping it a simple, dependency-free substitution honors KISS and avoids a templating engine.

### Result aggregation and XML

Each item run is wrapped to capture `{ id, status, duration_ms, text }`. After all items settle, results are serialized into a single `<swarm_results>` element with one `<item id=".." status="completed|error" duration_ms="..">` child per item, mirroring the `task` tool's existing `renderOutput` XML style. The XML envelope is the contract the orchestrating LLM reads, so it is stable and order-preserving by item.

### Background result-injection mechanism

Background mode reuses the `task` tool's pattern: register a background job, return an immediate acknowledgment, and on completion inject a synthetic message into the parent session via `promptOps.prompt(...)`. The swarm waits for all item jobs to settle, builds the aggregated `<swarm_results>` XML, and injects it as a single synthetic follow-up so the orchestrator sees one consolidated result rather than N separate notifications.

### Reuse of existing subagent/task infra

Per-item spawning reuses the building blocks already in `task.ts`: agent resolution, `deriveSubagentSessionPermission`, child session creation, and `promptOps` execution. Swarm is a fan-out coordinator over that primitive, not a parallel implementation, which keeps behavior (permissions, cancellation, prompt resolution) consistent with single-target tasks.

### Recursion guard

Swarm child sessions are created with the `task` and `swarm` permissions denied (the same `childToolDenies` pattern the `task` tool uses to deny nested `task`). This guarantees a swarm subagent cannot spawn its own subagents or swarms, bounding total spawn depth to one level.

### Alternatives considered

- **Loop of individual `task` calls by the LLM**: rejected. It pushes orchestration, throttling, and result stitching onto the model, is token-heavy in the orchestration turn, and is error-prone (dropped items, drifting prompts).
- **A generic worker-pool abstraction**: rejected as premature (YAGNI). The Effect semaphore over the existing spawn primitive covers the requirement with far less surface area.
- **Streaming partial results in foreground**: deferred. Foreground blocks and returns the full aggregate; incremental streaming adds protocol complexity not needed for the read-heavy use case.

## Risks / Trade-offs

- **[Risk] ~15x token cost for large fan-outs** → Mitigation: cap item count with `experimental.swarm_max_items` (default `20`), keep the feature opt-in and default-off, and document that swarm is for read-heavy independent work. Tie usage to orchestration guardrails so the orchestrator does not fan out speculatively.
- **[Risk] Write-conflict fragility on shared/overlapping code** → Mitigation: scope swarm to independent, no-shared-state items; declare parallel writes a non-goal and direct write-heavy parallelism to worktree isolation. The recursion guard and no-shared-state model keep items from stepping on each other through nested spawns.
- **[Risk] Runaway spawns** → Mitigation: concurrency is bounded by the `1-20` semaphore range, item count by `swarm_max_items`, and recursion is blocked by denying `task`/`swarm` in child sessions. These three bounds, plus default-off gating, align with the orchestration-guardrails capability and cap total resource use per swarm.

## Open Questions

- Missing-placeholder behavior: substitute empty string vs. fail item validation. Leaning toward failing fast at validation for a clear error.
- Should background swarms emit progress notifications as items complete, or only a single consolidated injection at the end? Current design favors one consolidated injection.
- Should `duration_ms` measure subagent wall-clock only, or include queue wait time while blocked on the concurrency semaphore? To be finalized during implementation.
- Per-item timeout: should there be a max duration per item to prevent a single stuck subagent from blocking foreground completion?
