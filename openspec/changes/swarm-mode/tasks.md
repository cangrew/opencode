# Swarm Mode Tasks

## 1. Config Schema

- [ ] 1.1 Add `experimental.swarm` (boolean, default `false`) to the experimental config schema in `packages/core/src/config/experimental.ts`.
- [ ] 1.2 Add `experimental.swarm_max_items` (number, default `20`), `experimental.swarm_concurrency` (number, default `5`), and `experimental.swarm_item_timeout_ms` (number, default `600000`) to the same schema.
- [ ] 1.3 Surface a runtime flag / resolver so the tool registry and `/swarm` command can read whether swarm is enabled.

## 2. SwarmTool Definition and Parameter Validation

- [ ] 2.1 Create the `SwarmTool` definition (new file under `packages/core/src/tool/`) following the `Tool.define` pattern used by `task.ts`.
- [ ] 2.2 Define parameters: `template` (string, required), `items` (array of `{ id, ...placeholders }`, required), `agent` (string, default `"general"`), `concurrency` (number `1-20`, default `5`), `background` (boolean, default `false`).
- [ ] 2.3 Validate at the boundary: reject missing `template`/`items`, reject `concurrency` outside `1-20`, and reject item counts exceeding `experimental.swarm_max_items` with clear errors.
- [ ] 2.4 Register the tool in the tool registry ONLY when `experimental.swarm` is enabled (gate exposure like background-subagents gating in `task.ts`).

## 3. Template Expansion

- [ ] 3.1 Implement pure `{{placeholder}}` substitution producing one expanded prompt per item, with `id` reserved as the item identifier.
- [ ] 3.2 Decide and implement missing-placeholder behavior (empty string vs. validation error) per the design Open Questions.

## 4. Concurrency-Limited Dispatch

- [ ] 4.1 Build a per-item runner that reuses existing subagent spawn infra (agent resolution, `deriveSubagentSessionPermission`, child session creation, `promptOps` execution).
- [ ] 4.2 Gate dispatch with an Effect `Semaphore` sized to the resolved `concurrency` so at most `concurrency` subagents run concurrently.
- [ ] 4.3 Capture per-item `{ id, status, duration_ms, text }`, measuring duration around each subagent run.

## 5. Result Aggregation and XML

- [ ] 5.1 Serialize collected per-item results into a single `<swarm_results>` element with one `<item id=".." status="completed|error" duration_ms="..">` child per item, order-preserving.
- [ ] 5.2 Return the aggregated XML as the foreground tool output.

## 6. Background Mode and Injection

- [ ] 6.1 In background mode, register background jobs and return an immediate acknowledgment.
- [ ] 6.2 Wait for all item jobs to settle, build the aggregated `<swarm_results>` XML, and inject it as a single synthetic follow-up message into the parent session (reuse the `task` tool injection mechanism).

## 7. Recursion Guard

- [ ] 7.1 Create swarm child sessions with `task` and `swarm` permissions denied so swarm subagents cannot spawn nested subagents or swarms (reuse the `childToolDenies` pattern from `task.ts`).

## 8. Per-Item Failure Isolation

- [ ] 8.1 Wrap each item run so an individual failure yields `status="error"` for that item only and never aborts the swarm; all other items run to completion.
- [ ] 8.2 Bound each item run by `experimental.swarm_item_timeout_ms`; on timeout, cancel that item's subagent and report it `status="error"` (timeout) so a single stuck item never blocks the swarm or the foreground tool call.
- [ ] 8.3 Count swarm item subagents toward the root session's `experimental.max_subagent_descendants` cap, holding pending items rather than exceeding it.

## 9. /swarm Slash Command

- [ ] 9.1 Add a server-side `/swarm` slash command in `packages/opencode`, gated on `experimental.swarm`.
- [ ] 9.2 Ensure the command is not registered when `experimental.swarm` is `false` or unset.

## 10. Unit Tests

- [ ] 10.1 Test template expansion: `{{placeholder}}` substitution per item, `id` handling, and missing-placeholder behavior.
- [ ] 10.2 Test concurrency cap: at most `concurrency` subagents in flight, and `swarm_max_items` rejection.
- [ ] 10.3 Test per-item failure isolation: one item errors, others complete and are reported `completed`.
- [ ] 10.3a Test per-item timeout: a hung item is forced to `status="error"` at `swarm_item_timeout_ms`, other items complete, and a foreground swarm returns rather than blocking.
- [ ] 10.4 Test structured-XML aggregation: `<swarm_results>` with correct `id`/`status`/`duration_ms` attributes.
- [ ] 10.5 Test parameter validation: missing `template`/`items` and out-of-range `concurrency` rejected.

## 11. Integration Test

- [ ] 11.1 End-to-end: enable `experimental.swarm`, invoke the SwarmTool with multiple items, assert foreground blocking returns full aggregated results and background mode injects the consolidated result.
- [ ] 11.2 Verify the recursion guard end-to-end: a swarm subagent attempting `task`/`swarm` is denied.

## 12. Docs

- [ ] 12.1 Document `experimental.swarm`, `experimental.swarm_max_items`, and `experimental.swarm_concurrency` in the config reference.
- [ ] 12.2 Document the SwarmTool and `/swarm` command, including the read-heavy use-case guidance and the parallel-writes-out-of-scope note (use worktree isolation instead).
