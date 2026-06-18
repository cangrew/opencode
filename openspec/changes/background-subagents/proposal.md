# Background Subagents + Push-to-Background

## Why

Subagent (Task) calls and primary sessions both block the user until they finish, even when the work is long-running and the user has nothing further to add to that thread. This forces serial waiting on independent work. Porting the opencode-x "background subagents" and "push-to-background" workflow (canonical commits `fee9af23c`, `7b48f1205`, `e3b000bed`) lets a Task call return immediately with a `task_id` while the subagent keeps running, and lets a running primary session be detached to the background with `Leader+D` so the prompt accepts new input right away. Completion is surfaced as a toast.

This is a low-risk latency and workflow win, but async execution HIDES cost: unobserved background runs can rack up large bills with no one watching, and toast/notification delivery is itself a failure surface (a dropped toast means a silently-finished run). For that reason this capability is opt-in and default-off, and depends on orchestration guardrails (loop, spawn, and budget caps) being present so a runaway background run is bounded.

## What Changes

- Add `experimental.background_subagents` config flag (default `false`). When off, the `background` Task param is silently ignored and execution is fully synchronous as today.
- Extend the Task tool with an optional `background: true` param: when enabled, the call returns immediately with a `task_id` instead of waiting for the subagent result.
- Add a `task_status(task_id)` tool to poll a background task's state (running / completed / failed) and retrieve its result once finished.
- Deliver background completion (subagent or detached session) as a TUI toast notification.
- Add a `Leader+D` keybind that detaches the running primary session to the background; the TUI prompt immediately accepts new input while the session keeps executing.
- Track background tasks per-session so the background indicator survives session navigation; allow a session to be re-pushed to background after an auto-resume.
- Pressing `esc` on the parent session interrupts its background subagents.
- Opt-in, default-off. No **BREAKING** changes: with the flag off, behavior is identical to today.

## Capabilities

### New Capabilities

- `background-subagents`: non-blocking subagent (Task) execution and push-to-background for primary sessions, gated by `experimental.background_subagents`, with `task_id` handles, `task_status` polling, completion toasts, per-session background tracking, `Leader+D` detach, and `esc`-driven interruption.

### Modified Capabilities

None — opt-in, default off.

## Impact

- **Packages**: `packages/core` (Task tool `background` param, background task lifecycle + `task_id` registry, `task_status` tool, session-detach execution path, `experimental.background_subagents` schema), `packages/tui` (`Leader+D` keybind wiring, prompt unblock on detach, per-session `bgTask` state, completion toast, `esc` interrupt routing), `packages/opencode` (config reference/docs surfacing).
- **Config**: new `experimental.background_subagents` flag (default `false`).
- **Dependencies**: depends on `orchestration-guardrails` (loop / spawn / budget caps) so unobserved background runs are bounded.
- **Runtime**: background work runs detached from the request that started it; results are delivered asynchronously via toast and pollable via `task_status`. With the flag off there is no behavioral change and no extra runtime cost.
