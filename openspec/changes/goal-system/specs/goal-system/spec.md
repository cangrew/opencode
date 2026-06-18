# Goal System

## ADDED Requirements

### Requirement: Set Objective via /goal

The system SHALL provide a `/goal <objective>` command that sets the active goal for the current session. The objective text MUST be stored and MUST drive subsequent autonomous turns. The command MAY accept an optional token budget at creation time.

#### Scenario: User sets an objective

- **WHEN** a user runs `/goal Refactor the auth module and update its tests` in a session with the goal system enabled
- **THEN** the session MUST record an active goal whose objective is that text and whose status is `active`

#### Scenario: User sets an objective with a token budget

- **WHEN** a user runs `/goal` with an objective and an optional token budget value
- **THEN** the created goal MUST store that token budget as its budget guard for the run

### Requirement: Single Active Goal Replaces Prior Goal

The system SHALL allow at most one active goal per session. Running `/goal` again MUST replace any existing goal regardless of its current state.

#### Scenario: New goal replaces an active goal

- **WHEN** a session already has an `active` goal and the user runs `/goal` with a new objective
- **THEN** the previous goal MUST be replaced and only the new goal MUST be active, with its turn counter reset

#### Scenario: New goal replaces a completed goal

- **WHEN** a session has a goal in `complete` or `budget_limited` or `paused` state and the user runs `/goal` with a new objective
- **THEN** the prior goal MUST be replaced by the new `active` goal

### Requirement: Auto-Continuation Between Turns

While a goal is `active`, the system SHALL drive the next turn automatically by emitting a continuation message at the runloop early-exit path instead of waiting for human input.

#### Scenario: Active goal triggers continuation

- **WHEN** an assistant turn reaches the runloop early-exit and the session's goal is `active`
- **THEN** the system MUST emit a continuation message that starts the next turn without requiring human input

#### Scenario: No active goal does not continue

- **WHEN** an assistant turn reaches the runloop early-exit and the session has no `active` goal
- **THEN** the system MUST NOT emit a continuation message and MUST wait for human input as it does today

### Requirement: Completion via goal_complete With Evidence

The system SHALL provide a `goal_complete` tool that transitions the active goal to `complete`. The tool MUST require completion evidence; a call without evidence MUST NOT complete the goal.

#### Scenario: Model completes with evidence

- **WHEN** the model calls `goal_complete` with evidence describing how the objective was satisfied
- **THEN** the goal status MUST transition to `complete` and auto-continuation MUST stop

#### Scenario: Completion attempt without evidence is rejected

- **WHEN** the model calls `goal_complete` without supplying evidence
- **THEN** the goal MUST remain `active` and the tool MUST return an error indicating evidence is required

### Requirement: MAX_TURNS Hard Cap

The system SHALL enforce a hard cap on the number of autonomous turns per goal, defaulting to 200. When the cap is reached, the goal MUST transition to `budget_limited` and auto-continuation MUST stop.

#### Scenario: Cap reached transitions to budget_limited

- **WHEN** an active goal reaches the configured `MAX_TURNS` cap (default 200)
- **THEN** the goal status MUST transition to `budget_limited` and no further continuation message MUST be emitted

#### Scenario: Below cap keeps running

- **WHEN** an active goal has used fewer turns than the `MAX_TURNS` cap
- **THEN** auto-continuation MUST continue and the turn counter MUST increment by one each turn

### Requirement: Optional Token Budget Pause

The system SHALL support an optional token budget set at goal creation. When cumulative token usage exceeds the budget, the goal MUST transition to `budget_limited` and execution MUST auto-pause.

#### Scenario: Token budget exceeded pauses the goal

- **WHEN** an active goal has a token budget and cumulative usage exceeds that budget
- **THEN** the goal status MUST transition to `budget_limited` and auto-continuation MUST stop

#### Scenario: No token budget set imposes no token limit

- **WHEN** an active goal was created without a token budget
- **THEN** token usage MUST NOT trigger a `budget_limited` transition, and only the `MAX_TURNS` cap MUST bound the run

### Requirement: Goal Status Injected Into Dynamic Prompt Section Only

The system SHALL inject the current goal status into the dynamic (uncached) section of the system prompt only. The status MUST NOT be placed in the cached prompt prefix, so that goal updates do not invalidate the cache. When `experimental.prompt_split_caching` is disabled there is no separate cached prefix; in that case the goal status is injected at its normal position in the system prompt and the prefix-protection clause does not apply.

#### Scenario: Status appears in the dynamic section

- **WHEN** a session has an `active` goal and a request prompt is assembled
- **THEN** the dynamic section MUST contain the Active Goal text, a `Turns: N/200 | Status: active` line, and a reminder to call `goal_complete` with evidence when complete

#### Scenario: Cached prefix is unchanged by goal updates

- **WHEN** `experimental.prompt_split_caching` is enabled and the goal status changes between turns (for example the turn counter increments)
- **THEN** the cached prompt prefix MUST remain byte-identical and only the dynamic section MUST reflect the new status

### Requirement: Synthetic Continuation Messages Hidden From TUI

The system SHALL mark auto-continuation messages as synthetic, and the TUI MUST hide synthetic messages from the rendered transcript.

#### Scenario: Continuation message is marked synthetic

- **WHEN** the system emits an auto-continuation message to drive the next turn
- **THEN** that message MUST carry a synthetic marker

#### Scenario: TUI hides synthetic continuation messages

- **WHEN** the TUI renders the session transcript containing synthetic continuation messages
- **THEN** those messages MUST NOT be displayed to the user

### Requirement: goal_complete Disabled For Subagent Sessions

The system SHALL NOT expose the `goal_complete` tool to subagent sessions.

#### Scenario: Subagent session lacks goal_complete

- **WHEN** the tool registry assembles tools for a subagent session
- **THEN** the `goal_complete` tool MUST NOT be present in that subagent's available tools

#### Scenario: Primary session retains goal_complete

- **WHEN** the tool registry assembles tools for a primary (non-subagent) session with the goal system enabled
- **THEN** the `goal_complete` tool MUST be available

### Requirement: Model Variant Preserved On Auto-Resume

The system SHALL preserve the model variant when a goal auto-resumes after a push-to-background.

#### Scenario: Variant preserved across background resume

- **WHEN** a goal-driven session is pushed to background and later auto-resumes
- **THEN** the resumed turns MUST use the same model variant the session was using before the background push

### Requirement: Manual Pause And Resume

The system SHALL let the user manually pause an `active` goal and resume a `paused` or `budget_limited` goal, distinct from the automatic guard stops. The four goal states are: `active` (auto-continuing), `paused` (user-initiated stop), `budget_limited` (guard-initiated stop on MAX_TURNS or token budget), and `complete` (terminal). A manual pause transitions `active` to `paused` and stops auto-continuation without discarding the goal or resetting its turn counter. A resume transitions `paused` back to `active` and re-enables auto-continuation from the retained turn counter. Resuming a `budget_limited` goal MUST also raise the exhausted limit (a higher `MAX_TURNS` override or a larger token budget); resuming a `budget_limited` goal without raising the limit that stopped it MUST leave it `budget_limited` and emit no continuation, because it would immediately re-trip the same guard.

#### Scenario: Active goal can be manually paused

- **WHEN** the user pauses an `active` goal
- **THEN** the goal transitions to `paused`, auto-continuation stops, and the goal and its turn counter are retained

#### Scenario: Paused goal resumes to active

- **WHEN** the user resumes a `paused` goal
- **THEN** the goal transitions to `active` and auto-continuation resumes from the retained turn counter

#### Scenario: Resuming a budget_limited goal requires raising the limit

- **WHEN** the user resumes a `budget_limited` goal and raises the exhausted limit (a higher MAX_TURNS override or a larger token budget)
- **THEN** the goal transitions to `active` and auto-continuation resumes

#### Scenario: Resuming budget_limited without more budget does not continue

- **WHEN** the user resumes a `budget_limited` goal without raising the limit that stopped it
- **THEN** the goal remains `budget_limited` and emits no continuation message
