# orchestration-guardrails

## ADDED Requirements

### Requirement: Loop detection

The system SHALL hash each task/tool call by tool name plus arguments and track the most recent calls per session in a ring buffer. When the number of consecutive identical hashes reaches `experimental.loop_detector_threshold` (default `5`), the system MUST abort the running agent with an explicit loop-detected error and MUST NOT execute the repeated call again.

#### Scenario: Threshold of identical calls aborts the agent

- **WHEN** an agent issues `experimental.loop_detector_threshold` (default `5`) consecutive task/tool calls with identical tool name and arguments
- **THEN** the system aborts the agent with a loop-detected error and does not execute the call again

#### Scenario: Differing calls do not trigger detection

- **WHEN** an agent issues calls whose tool name or arguments differ before `loop_detector_threshold` identical repeats accumulate
- **THEN** the consecutive-identical counter resets and execution continues normally

#### Scenario: Threshold is configurable

- **WHEN** `experimental.loop_detector_threshold` is set to a value other than the default `5`
- **THEN** the system aborts only after that configured number of consecutive identical calls

#### Scenario: Varied or alternating calls are not caught by loop detection

- **WHEN** an agent loops by alternating between two distinct calls, or by varying one argument on each iteration, so no run of identical calls reaches `loop_detector_threshold`
- **THEN** loop detection does NOT abort the agent, and the runaway is bounded only by the doom-loop hard cap (loop detection catches consecutive-identical repeats only; near-duplicate / no-progress detection is a separate follow-up)

### Requirement: Doom-loop hard cap

The system SHALL enforce a per-process agent ruleset that stops infinite loops even when permissions auto-allow every call. The hard cap is a fixed ceiling of `1000` total task and tool calls per root session, counted across the root session and all of its descendant subagents; it is NOT configurable, so it cannot be raised or disabled. When a root session reaches this ceiling, the system MUST abort the agent with an explicit doom-loop error and MUST NOT execute any further task or tool call for that root session. This hard cap MUST operate independently of `experimental.loop_detector_threshold` so that a runaway agent is stopped even if the configurable loop threshold is raised or disabled.

#### Scenario: Root session aborts at the fixed call ceiling

- **WHEN** a root session and its descendants together reach `1000` total task/tool calls
- **THEN** the system aborts the agent with a doom-loop error and executes no further calls for that root session

#### Scenario: Auto-allowed permissions do not bypass the hard cap

- **WHEN** an agent runs with permissions configured to auto-allow and enters an infinite call loop
- **THEN** the per-process doom-loop ruleset halts the agent regardless of the auto-allow permission setting

#### Scenario: Hard cap independent of loop_detector_threshold

- **WHEN** `experimental.loop_detector_threshold` is raised high or disabled while an agent loops indefinitely
- **THEN** the doom-loop hard cap still stops the agent

### Requirement: Spawn depth limit

The system SHALL track subagent nesting depth on the session tree and MUST reject any spawn that would exceed `experimental.max_subagent_depth` (default `3`), returning an explicit depth-exceeded error to the requesting agent.

#### Scenario: Spawn within depth limit succeeds

- **WHEN** a subagent at nesting depth below `experimental.max_subagent_depth` (default `3`) requests to spawn a child
- **THEN** the child subagent is spawned and its depth is recorded as one greater than its parent

#### Scenario: Spawn exceeding depth limit is rejected

- **WHEN** a subagent already at depth `experimental.max_subagent_depth` (default `3`) requests to spawn a child
- **THEN** the spawn is rejected with a depth-exceeded error and no child subagent is created

### Requirement: Descendant cap

The system SHALL track the number of currently-active descendant subagents under each root session and MUST reject any spawn that would exceed `experimental.max_subagent_descendants` (default `50`), returning an explicit descendant-cap error. The count is incremented when a descendant is spawned and decremented when a descendant reaches a terminal state (completed, failed, or cancelled), so the cap bounds concurrent fan-out rather than the lifetime total. A long-running root session that has already cycled many descendants through completion is therefore never permanently blocked from spawning.

#### Scenario: Spawn within descendant cap succeeds

- **WHEN** a root session has fewer than `experimental.max_subagent_descendants` (default `50`) currently-active descendants and a new subagent is requested
- **THEN** the subagent is spawned and the root session's active-descendant count is incremented

#### Scenario: Completed descendant frees a slot

- **WHEN** a root session is at the descendant cap and one active descendant reaches a terminal state
- **THEN** the active-descendant count is decremented and a subsequent spawn within the cap succeeds

#### Scenario: Spawn exceeding descendant cap is rejected

- **WHEN** a root session already has `experimental.max_subagent_descendants` (default `50`) currently-active descendants and a new subagent is requested
- **THEN** the spawn is rejected with a descendant-cap error and no subagent is created

### Requirement: Per-model concurrency

The system SHALL limit concurrent in-flight model calls per `providerID:modelID` key to at most `experimental.model_concurrency` (default `5`). Calls that would exceed the cap MUST wait until a slot is released rather than failing.

#### Scenario: Concurrent calls capped per model

- **WHEN** more than `experimental.model_concurrency` (default `5`) calls target the same `providerID:modelID` key at once
- **THEN** at most `experimental.model_concurrency` calls run concurrently and the rest queue until a slot frees

#### Scenario: Different models do not share a slot pool

- **WHEN** calls target distinct `providerID:modelID` keys
- **THEN** each key enforces its own independent concurrency limit of `experimental.model_concurrency`

### Requirement: Category routing

The system SHALL resolve the task tool's `task_category` parameter against `experimental.task_categories` (default empty) and route the task to the mapped `{ providerID, modelID }`. When the category is unset or unmapped, the system MUST fall back to the default model with no error.

#### Scenario: Mapped category routes to its model

- **WHEN** a task is invoked with a `task_category` that exists in `experimental.task_categories`
- **THEN** the task runs on the provider/model mapped to that category

#### Scenario: Unmapped category falls back

- **WHEN** a task is invoked with a `task_category` that is not present in `experimental.task_categories` (default empty)
- **THEN** the task runs on the default model without error

### Requirement: Ultrawork routing

The system SHALL route a task to `experimental.ultrawork_model` when the task prompt contains `ulw` or `ultrawork`, or when `use_ultrawork: true` is set. When `ultrawork_model` is unset, the system MUST fall back to the default model with no error.

#### Scenario: Prompt keyword triggers ultrawork routing

- **WHEN** a task prompt contains `ulw` or `ultrawork` and `experimental.ultrawork_model` is configured
- **THEN** the task is routed to `experimental.ultrawork_model`

#### Scenario: Explicit flag triggers ultrawork routing

- **WHEN** a task sets `use_ultrawork: true` and `experimental.ultrawork_model` is configured
- **THEN** the task is routed to `experimental.ultrawork_model`

#### Scenario: Ultrawork unset falls back

- **WHEN** ultrawork is requested but `experimental.ultrawork_model` is unset
- **THEN** the task runs on the default model without error

### Requirement: Safe parallel tool calls

The system SHALL execute tool calls in parallel ONLY when `experimental.parallel_tool_calls` (default `false`) is enabled AND all active tool calls in the batch are pre-approved and parallel-safe. The read tool SHALL participate in parallel execution only when `experimental.parallel_read` (default `false`) is enabled, which MUST require `experimental.parallel_tool_calls` to also be enabled. In all other cases tool calls MUST run sequentially.

#### Scenario: Parallel execution gated to safe pre-approved tools

- **WHEN** `experimental.parallel_tool_calls` is `true` and every tool call in a batch is pre-approved and parallel-safe
- **THEN** the batch runs in parallel

#### Scenario: Unsafe or unapproved tool forces sequential

- **WHEN** `experimental.parallel_tool_calls` is `true` but a batch contains a tool call that is not pre-approved or not parallel-safe
- **THEN** the batch runs sequentially

#### Scenario: Parallel read requires parallel tool calls

- **WHEN** `experimental.parallel_read` is `true` but `experimental.parallel_tool_calls` is `false`
- **THEN** the read tool does not participate in parallel execution and tool calls run sequentially

#### Scenario: Defaults keep execution sequential

- **WHEN** `experimental.parallel_tool_calls` and `experimental.parallel_read` are both at their default `false`
- **THEN** all tool calls run sequentially
