# background-subagents Specification

## ADDED Requirements

### Requirement: Background Task Returns Immediately With task_id

When `experimental.background_subagents` is enabled and a Task tool call is invoked with `background: true`, the call SHALL return immediately with a stable `task_id` identifying the spawned subagent, without waiting for the subagent to finish. The subagent MUST continue executing detached from the originating tool call.

#### Scenario: background Task call returns a task_id without blocking
- **WHEN** the flag is enabled and a Task tool call is invoked with `background: true`
- **THEN** the tool returns a result containing a `task_id` immediately and the subagent keeps running in the background

### Requirement: Gating By experimental.background_subagents

The `background` Task param SHALL be honored only when `experimental.background_subagents` is `true`. When the flag is `false` (the default), the `background` param MUST be silently ignored and the Task call MUST execute synchronously exactly as it does today.

#### Scenario: background param is ignored when the flag is off
- **WHEN** `experimental.background_subagents` is `false` and a Task call is invoked with `background: true`
- **THEN** the call executes synchronously and returns the full subagent result, with no `task_id` and no error about the ignored param

### Requirement: task_status Polling

A `task_status(task_id)` tool SHALL report the current state of a background task as one of running, completed, failed, or cancelled, and SHALL return the task's result once it has completed or the error once it has failed. A task that is interrupted (see "Esc On Parent Interrupts Background Subagents") or whose owning session is deleted MUST be reported as `cancelled`.

#### Scenario: polling a completed background task returns its result
- **WHEN** `task_status` is called with the `task_id` of a background task that has finished
- **THEN** it returns a `completed` state together with the subagent's final result

#### Scenario: polling a cancelled background task reports cancelled
- **WHEN** `task_status` is called with the `task_id` of a background task that was interrupted before finishing
- **THEN** it returns a `cancelled` state rather than `running`, `completed`, or `failed`

### Requirement: Background Completion Toast

When a background subagent or a detached primary session completes, the TUI SHALL surface the completion as a toast notification identifying the finished task or session.

#### Scenario: a completed background subagent fires a toast
- **WHEN** a background subagent finishes execution
- **THEN** the TUI shows a toast notification announcing that the background task completed

### Requirement: Leader+D Detaches Session And Unblocks Prompt

A running primary session SHALL be detachable to the background via the `Leader+D` keybind. On detach, the TUI prompt MUST immediately accept new input while the detached session keeps executing in the background.

#### Scenario: Leader+D detaches and the prompt accepts input immediately
- **WHEN** the user presses `Leader+D` while a primary session is running
- **THEN** the session continues executing in the background and the prompt immediately becomes available for new input

### Requirement: Per-Session Background Task Tracking

Background tasks SHALL be tracked per-session so the background indicator survives session navigation. The detached session MUST remain in the session list while it runs.

#### Scenario: background indicator survives navigation away and back
- **WHEN** the user navigates away from a session with a running background task and then returns to it
- **THEN** the background indicator for that session is still shown and the session is still present in the session list

### Requirement: Re-Push After Auto-Resume

A session that has been auto-resumed SHALL be eligible to be pushed to the background again via `Leader+D`.

#### Scenario: a session can be re-pushed after an auto-resume
- **WHEN** a previously backgrounded session is auto-resumed and is running again
- **THEN** pressing `Leader+D` detaches it to the background a second time and the prompt unblocks

### Requirement: Esc On Parent Interrupts Background Subagents

Pressing `esc` on a parent session SHALL interrupt that session's background subagents.

#### Scenario: esc on the parent cancels its background subagents
- **WHEN** the user presses `esc` on a parent session that has running background subagents
- **THEN** those background subagents are interrupted and their tasks transition to the `cancelled` terminal state, after which `task_status` reports them as `cancelled`

### Requirement: Background Task Ownership On Parent Termination

A background task SHALL be owned by the session that started it. When that owning session is deleted, the system MUST cancel the session's background tasks (transitioning them to `cancelled`) and remove their registry entries, so no background task keeps running detached from a deleted owner. Because the registry is in-memory for this change, a full process restart ends all background tasks; `task_status` called with a `task_id` that no longer exists MUST return a clear not-found result rather than a stale state.

#### Scenario: deleting the owning session cancels its background tasks
- **WHEN** a session that owns running background tasks is deleted
- **THEN** those background tasks are cancelled, their registry entries are removed, and none continues executing

#### Scenario: task_status returns not-found after the task no longer exists
- **WHEN** `task_status` is called with a `task_id` whose entry has been removed (its owner was deleted or the process restarted)
- **THEN** it returns a clear not-found result rather than reporting a stale running, completed, or failed state
