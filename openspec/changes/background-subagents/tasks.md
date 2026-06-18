# Tasks: Background Subagents + Push-to-Background

## 1. Config

- [ ] 1.1 Add `experimental.background_subagents` (boolean, default `false`) to the experimental config schema in `packages/core/src/config/experimental.ts`.
- [ ] 1.2 Thread the resolved flag into the Task tool runtime and the session-detach path so both can check whether background execution is enabled.
- [ ] 1.3 Ensure that when the flag is off, the `background` param is silently ignored (no error, fully synchronous behavior).

## 2. Background Task Lifecycle + task_id

- [ ] 2.1 Add a background task registry in `packages/core` keyed by `task_id`, with immutable entries carrying state (`running` | `completed` | `failed` | `cancelled`), owning session id, cancellation handle, and result/error.
- [ ] 2.5 Cancel and remove a session's background tasks when the owning session is deleted; return a not-found result from `task_status` for ids that no longer exist (including after a process restart).
- [ ] 2.2 Generate an opaque, collision-free `task_id` for each background task.
- [ ] 2.3 Add a `background` optional param to the Task tool; when enabled, start the subagent detached and return immediately with the `task_id`.
- [ ] 2.4 On subagent completion or failure, update the registry entry immutably and emit a completion event.

## 3. task_status Tool

- [ ] 3.1 Implement a `task_status(task_id)` core tool that returns the entry's state (`running` | `completed` | `failed` | `cancelled`) and, when completed, the subagent result (or the error on failure).
- [ ] 3.2 Return a clear not-found result for unknown `task_id` instead of throwing.
- [ ] 3.3 Register `task_status` in the tool registry alongside the Task tool.

## 4. Toast / Completion Delivery

- [ ] 4.1 Subscribe the TUI to core background-task completion events.
- [ ] 4.2 On completion or failure, show a toast via `useToast().show(...)` identifying the finished task or session (`packages/tui/src/ui/toast.tsx`).
- [ ] 4.3 Keep toast delivery best-effort; rely on `task_status` as the durable source of truth.

## 5. Leader+D Detach + Prompt Unblock

- [ ] 5.1 Add a `session_background` keybind defaulting to `<leader>d` in `packages/tui/src/config/keybind.ts`.
- [ ] 5.2 Implement the detach handler: move the running session to the background task path and set its `bgTask` state.
- [ ] 5.3 Immediately return the prompt to an input-ready state on detach so new input is accepted right away.

## 6. Per-Session bgTask State

- [ ] 6.1 Add a per-session `bgTask` field with immutable updates describing the running background task.
- [ ] 6.2 Render a background indicator from `bgTask` so it survives navigation away and back.
- [ ] 6.3 Keep the detached session in the session list while it runs.

## 7. Re-Push After Auto-Resume

- [ ] 7.1 Ensure the detach handler is driven by current run-state (not a one-shot flag) so an auto-resumed session can be pushed to background again.
- [ ] 7.2 Verify `bgTask` is reset/re-set correctly across the resume then re-detach cycle.

## 8. Esc Interrupt

- [ ] 8.1 On `esc` at a parent session, look up that session's background subagents in the registry.
- [ ] 8.2 Trigger their cancellation handles and transition entries to the `cancelled` terminal state.

## 9. Tests

- [ ] 9.1 Unit test: `background: true` returns a `task_id` immediately when the flag is on.
- [ ] 9.2 Unit test: `background` param is silently ignored and execution is synchronous when the flag is off.
- [ ] 9.3 Unit test: `task_status` returns running, then completed-with-result, then not-found for unknown ids.
- [ ] 9.4 Unit test: completion/failure updates the registry entry immutably and emits an event.
- [ ] 9.5 Unit test: `esc` on the parent interrupts its background subagents and `task_status` reports them `cancelled`; deleting the owning session cancels and removes its tasks, after which `task_status` returns not-found.
- [ ] 9.6 TUI integration test: `Leader+D` detaches a running session and the prompt accepts input immediately.
- [ ] 9.7 TUI integration test: the background indicator survives navigation, and re-push after auto-resume works.
- [ ] 9.8 TUI integration test: a completed background task fires a toast.

## 10. Docs

- [ ] 10.1 Document `experimental.background_subagents` (default off) and its dependency on `orchestration-guardrails`.
- [ ] 10.2 Document the `background` Task param, the `task_status` tool, the `Leader+D` keybind, and `esc` interrupt behavior.
