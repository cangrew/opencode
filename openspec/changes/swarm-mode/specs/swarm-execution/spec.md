# swarm-execution

## ADDED Requirements

### Requirement: Template and Items Expansion

The SwarmTool SHALL accept a required `template` string containing `{{placeholder}}` markers and a required `items` array, and MUST expand the template once per item by substituting each `{{placeholder}}` with the matching key/value field from that item. Each expanded prompt SHALL spawn one independent subagent session (no shared state between items).

#### Scenario: Template expanded per item

- **WHEN** a swarm is invoked with `template` `"Review {{file}}"` and `items` `[{ id: "a", file: "x.ts" }, { id: "b", file: "y.ts" }]`
- **THEN** two subagent sessions are spawned, one prompted with `"Review x.ts"` and one with `"Review y.ts"`, each running independently with no shared state

#### Scenario: Missing template or items is rejected

- **WHEN** a swarm is invoked without a `template` or without an `items` array
- **THEN** the tool MUST fail validation with a clear error and spawn no subagents

### Requirement: Concurrency Cap Enforcement

The SwarmTool SHALL run subagent sessions in parallel up to a `concurrency` limit (default `5`, valid range `1-20`), and MUST never exceed `experimental.swarm_concurrency` as the configured default nor the `20` hard maximum. The number of items MUST NOT exceed `experimental.swarm_max_items` (default `20`); a swarm exceeding that cap is rejected. Swarm item subagents are descendants of the originating root session and count toward `experimental.max_subagent_descendants` (see orchestration-guardrails); item dispatch MUST respect that cap, holding pending items rather than exceeding it.

#### Scenario: Concurrency limits in-flight subagents

- **WHEN** a swarm has 12 items and `concurrency` is `5`
- **THEN** at most 5 subagent sessions run at any one time, and remaining items start as in-flight sessions complete

#### Scenario: Concurrency parameter clamped to valid range

- **WHEN** a swarm is invoked with `concurrency` outside the `1-20` range
- **THEN** the tool MUST fail validation with a clear error and spawn no subagents

#### Scenario: swarm_max_items cap enforced

- **WHEN** a swarm is invoked with more items than `experimental.swarm_max_items`
- **THEN** the tool MUST reject the request with a clear error referencing the cap and spawn no subagents

### Requirement: Foreground Blocking Result

In foreground mode (`background=false`, the default) the SwarmTool SHALL block until every item has completed or errored, then return the full aggregated results in a single tool response.

#### Scenario: Foreground returns all results

- **WHEN** a swarm runs in foreground mode with 3 items
- **THEN** the tool call does not return until all 3 items have finished, and the response contains the aggregated result for every item

### Requirement: Background Deferred Injection

In background mode (`background=true`) the SwarmTool SHALL return immediately with an acknowledgment and MUST inject the aggregated results into the originating conversation when all items have completed.

#### Scenario: Background acknowledges then injects

- **WHEN** a swarm is invoked with `background=true`
- **THEN** the tool returns immediately with an acknowledgment that the swarm is running
- **AND WHEN** all items later complete
- **THEN** the aggregated results are injected into the conversation as a follow-up message

### Requirement: Structured XML Result Format

The SwarmTool SHALL aggregate per-item results into a single `<swarm_results>` element, with one `<item>` child per item carrying `id`, a `status` of `completed` or `error`, and a `duration_ms` attribute.

#### Scenario: Results serialized as swarm_results XML

- **WHEN** a swarm completes with one successful item `a` and one failed item `b`
- **THEN** the result is a `<swarm_results>` element containing `<item id="a" status="completed" duration_ms="...">...</item>` and `<item id="b" status="error" duration_ms="...">...</item>`

### Requirement: Per-Item Failure Isolation

The SwarmTool MUST process items independently so that an individual item failure never aborts the swarm; a failed item SHALL be reported with `status="error"` while all other items continue and complete normally.

#### Scenario: One item fails, others complete

- **WHEN** a swarm has 4 items and the subagent for one item throws an error
- **THEN** that item is reported with `status="error"` and the remaining 3 items still run and are reported with `status="completed"`

### Requirement: Per-Item Timeout

Each swarm item subagent SHALL be bounded by a timeout. When an item runs longer than `experimental.swarm_item_timeout_ms` (default `600000`, ten minutes), the system MUST cancel that item's subagent and report it with `status="error"` and a timeout indication, without blocking the other items or the swarm as a whole. In foreground mode this guarantees the blocking tool call always returns and cannot hang indefinitely on a single stuck item.

#### Scenario: A hung item times out without blocking the swarm

- **WHEN** one item's subagent runs longer than `experimental.swarm_item_timeout_ms` while other items proceed
- **THEN** the timed-out item is cancelled and reported with `status="error"`, the other items complete normally, and the swarm returns its aggregated results

#### Scenario: Foreground swarm always returns despite a stuck item

- **WHEN** a foreground swarm has one item that never completes on its own
- **THEN** that item is forced to `status="error"` at the timeout and the foreground tool call returns the aggregated results rather than blocking forever

### Requirement: No-Recursion Restriction

Subagents spawned by a swarm MUST NOT be able to spawn their own subagents or swarms; the `task` and `swarm` tools SHALL be unavailable inside swarm subagent sessions.

#### Scenario: Swarm subagent cannot spawn nested work

- **WHEN** a subagent running inside a swarm attempts to call the `task` or `swarm` tool
- **THEN** the call is denied and no nested subagent or swarm is spawned

### Requirement: Slash Command Gating

The system SHALL expose a server-side `/swarm` slash command that is available ONLY when `experimental.swarm` is `true`. When `experimental.swarm` is `false` or unset, neither the `/swarm` command nor the `SwarmTool` is available.

#### Scenario: Command available when experimental flag is on

- **WHEN** `experimental.swarm` is `true`
- **THEN** the `/swarm` command and the `SwarmTool` are registered and usable

#### Scenario: Command hidden when experimental flag is off

- **WHEN** `experimental.swarm` is `false` or unset
- **THEN** the `/swarm` command is not registered and the `SwarmTool` is not exposed to the LLM
