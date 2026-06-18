# Tasks: Goal System

## 1. Configuration

- [ ] 1.1 Add `experimental.goal_system` boolean to `packages/core/src/config/experimental.ts`, default `false`.
- [ ] 1.2 Gate all goal-system code paths on the flag so non-opted-in sessions keep today's single-turn behavior.

## 2. Goal State Model and Storage

- [ ] 2.1 Define an immutable goal record (objective text, optional token budget, turn counter, cumulative token usage, model variant, status).
- [ ] 2.2 Define the status union: `active`, `complete`, `budget_limited`, `paused`.
- [ ] 2.3 Implement state transitions as pure functions returning new records (active to complete, active to budget_limited, active to paused, paused to active on resume, and budget_limited to active on resume only when the exhausted limit is raised).
- [ ] 2.4 Add per-session goal storage in `packages/core/src/session/`, enforcing at most one active goal.
- [ ] 2.5 Implement replace-on-new-goal: a new goal supersedes any prior goal in any state and resets the turn counter.

## 3. /goal Command

- [ ] 3.1 Add the `/goal <objective>` slash command in `packages/opencode`.
- [ ] 3.2 Parse the objective text and an optional token budget argument.
- [ ] 3.3 Wire the command to create or replace the session's active goal.
- [ ] 3.4 Add `/goal pause` (active to paused, stops continuation) and `/goal resume` (paused to active; for a budget_limited goal, resume only when a raised MAX_TURNS/token budget is supplied, else leave it budget_limited).

## 4. goal_complete Tool

- [ ] 4.1 Implement the `goal_complete` tool in `packages/core/src/tool/`.
- [ ] 4.2 Require a completion-evidence input; reject calls without evidence and keep the goal active.
- [ ] 4.3 On valid evidence, transition the active goal to `complete` and stop continuation.

## 5. Auto-Continuation Runloop Hook

- [ ] 5.1 Add the continuation check at the runloop early-exit path.
- [ ] 5.2 When the goal is `active` and no guard has fired, emit a continuation message that starts the next turn.
- [ ] 5.3 Increment the goal turn counter once per autonomous turn.

## 6. Guards

- [ ] 6.1 Implement the `MAX_TURNS` hard cap with default 200; on reach, transition to `budget_limited` and stop continuation.
- [ ] 6.2 Implement the optional token budget; track cumulative usage and, on exceed, transition to `budget_limited` and auto-pause.
- [ ] 6.3 Ensure a goal with no token budget is bounded only by `MAX_TURNS`.

## 7. Dynamic Prompt Injection

- [ ] 7.1 Register a system-context entry that injects goal status into the dynamic (uncached) section only.
- [ ] 7.2 Render Active Goal text, the `Turns: N/200 | Status: active` line, and the "call goal_complete with evidence" reminder.
- [ ] 7.3 Verify the cached prompt prefix stays byte-identical as the turn counter changes (ties to prompt-cache-stability).

## 8. Synthetic Continuation Messages

- [ ] 8.1 Mark auto-continuation messages with a synthetic marker.
- [ ] 8.2 Hide synthetic continuation messages in the TUI message rendering (`packages/tui`).

## 9. Subagent Gating

- [ ] 9.1 In the tool registry, omit `goal_complete` from subagent sessions.
- [ ] 9.2 Confirm `goal_complete` is present for primary sessions when the flag is on.

## 10. Model-Variant Preservation

- [ ] 10.1 Persist the model variant on the goal record.
- [ ] 10.2 On push-to-background auto-resume, restore and use the preserved model variant.

## 11. Tests

- [ ] 11.1 Unit test goal state transitions (active to complete, to budget_limited, to paused; paused resume to active; budget_limited resume only with a raised limit; replace-on-new-goal resets the counter).
- [ ] 11.2 Unit test MAX_TURNS cap enforcement (transition at the cap, continue below it).
- [ ] 11.3 Unit test token-budget pause (exceed transitions to budget_limited; no budget imposes no token limit).
- [ ] 11.4 Unit test that `goal_complete` rejects evidence-free calls and accepts evidence.
- [ ] 11.5 Unit test that goal status lands in the dynamic section and not the cached prefix.
- [ ] 11.6 Unit test that subagent tool assembly omits `goal_complete`.
- [ ] 11.7 Integration test: `/goal` sets an objective, the loop auto-continues across turns, and ends on `goal_complete` with evidence; a separate run ends at the MAX_TURNS cap.

## 12. Documentation

- [ ] 12.1 Document the `experimental.goal_system` flag, the `/goal` command, the guards (MAX_TURNS, token budget), and the goal states.
- [ ] 12.2 Note the recommended re-anchor-at-compaction mitigation for goal drift.
