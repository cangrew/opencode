# Design: Background Subagents + Push-to-Background

## Context

Today both subagent (Task) calls and primary sessions are synchronous from the user's point of view: the tool call or the prompt blocks until the work finishes. The opencode-x fork (commits `fee9af23c`, `7b48f1205`, `e3b000bed`) added two related affordances: a `background: true` Task param that returns a `task_id` immediately, and a `Leader+D` keybind that detaches a running primary session so the prompt is freed. Completion is surfaced via toast. This change ports that behavior into this monorepo: Task tool execution and the experimental config live in `packages/core`; keybinds, toasts, and session navigation live in `packages/tui`.

The core constraint is cost visibility: async execution hides cost. An unobserved background run can consume large amounts of tokens with no one watching, and a dropped completion toast means the run finishes silently. This capability therefore ships opt-in and default-off, and assumes the `orchestration-guardrails` capability (loop / spawn / budget caps) is present to bound any single background run.

## Goals / Non-Goals

Goals:
- Let a Task call with `background: true` return a `task_id` immediately and run detached.
- Provide a `task_status(task_id)` tool to poll state and retrieve the result.
- Let `Leader+D` detach a running primary session and immediately unblock the prompt.
- Track background tasks per-session so the indicator survives navigation; support re-push after auto-resume; let `esc` on the parent interrupt background subagents.
- Deliver completion via toast.

Non-Goals:
- Persisting background tasks across full app restarts (in-memory lifecycle for this change).
- A general job queue, scheduling, or prioritization system.
- Cross-machine / remote background execution.
- Defining the guardrail caps themselves (owned by `orchestration-guardrails`).

## Decisions

- **Lifecycle tracking**: A background task registry in `packages/core` holds entries keyed by `task_id`, each carrying state (`running` | `completed` | `failed` | `cancelled`), the owning session id, a cancellation handle, and (once finished) the result or error. Entries are created when a `background: true` Task call (or a `Leader+D` detach) starts and updated immutably as state changes (a new entry object replaces the old one rather than mutating in place).
- **task_id scheme**: Opaque, collision-free identifier (e.g. a generated id) returned synchronously from the Task call. It is the only handle the model and TUI hold; all polling and interruption route through it.
- **task_status tool**: A read-only core tool that looks up the registry entry for a `task_id` and returns its state plus, when completed, the subagent result (or the error on failure). Unknown ids return a clear not-found result rather than throwing.
- **Toast / notification delivery**: On task completion or failure the core lifecycle emits an event the TUI subscribes to; the TUI calls the existing `useToast().show(...)` path (`packages/tui/src/ui/toast.tsx`). Delivery is best-effort UI; `task_status` is the durable source of truth so a missed toast never loses the result.
- **Per-session state model in TUI**: Each session entry carries a `bgTask` field (immutable update on change) describing whether it has a running background task. Because state is keyed by session, navigating away and back re-reads the same `bgTask`, so the indicator survives navigation. The session stays in the session list while detached.
- **Leader+D keybind wiring**: Add a `session_background` (or similar) keybind defaulting to `<leader>d` in `packages/tui/src/config/keybind.ts`. Its handler detaches the active session: it moves execution to the background task path, sets the session's `bgTask`, and immediately returns the prompt to an input-ready state. Re-push after auto-resume is handled by the same path because detach is driven by current session run-state, not a one-shot flag.
- **Esc interruption**: `esc` on a parent session looks up that session's background subagents in the registry and triggers their cancellation handles, transitioning entries to the `cancelled` terminal state. The same cancellation path runs when the owning session is deleted: its background tasks are cancelled and their registry entries removed so nothing keeps running detached from a deleted owner. Because the registry is in-memory, a process restart ends all background tasks, and `task_status` for a removed `task_id` returns not-found rather than a stale state.
- **Dependency on guardrails**: This capability assumes `orchestration-guardrails` loop / spawn / budget caps are active so a detached run cannot grow unbounded while unobserved. The flag default-off keeps the feature dark until those guardrails are in place.
- **Alternatives considered — synchronous-only**: Keep all Task calls and sessions blocking. Rejected because it forces serial waiting on independent work, which is the exact latency cost this port removes. The synchronous path is preserved verbatim as the default (flag off), so synchronous-only remains the safe fallback rather than being deleted.

## Risks / Trade-offs

- **[Risk] Hidden cost on unobserved background runs** → Mitigation: gate behind `experimental.background_subagents` (default off) and depend on `orchestration-guardrails` budget / loop / spawn caps so any single background run is bounded even when no one is watching.
- **[Risk] Notification-delivery failure (a dropped toast finishes a run silently)** → Mitigation: treat the toast as best-effort and make `task_status` the durable source of truth; handle interruption carefully so a cancelled or failed task always reaches a terminal, pollable state rather than disappearing.
- **[Risk] Per-session state drift across navigation** → Mitigation: key background state by session id with immutable updates so navigation re-reads consistent `bgTask` state.
- **[Trade-off] In-memory lifecycle** → background tasks do not survive a full restart; acceptable for the first port and called out in Open Questions.

## Open Questions

- Should background task state persist across app restarts (e.g. into the session store), or remain in-memory for this change?
- What is the toast retention / re-surfacing behavior if the user is mid-input when a background task completes?
- How many concurrent background subagents per session should be allowed before guardrails reject new ones?
- Should `task_status` support listing all background tasks for a session, or only single-id lookup?
