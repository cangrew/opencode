# Goal System

## Why

Today every assistant turn ends at the runloop early-exit and waits for fresh human input. There is no way to hand the agent a standing objective and let it drive itself across many turns until the work is actually done. The "goal system" ported from the opencode-x fork (canonical commits bb9f0d546, 929ceb34f, 563856741, 98208905f) adds exactly that: `/goal` sets a single objective for the session, the agent receives auto-continuation messages between turns, and it keeps working until it calls a `goal_complete` tool with evidence or a guard stops it.

Autonomy is not free, and the evidence is blunt about it. Reliability decays sharply with task length (roughly 100% under 4 minutes, under 10% past 4 hours), and goal drift is universal as the context grows. The mitigations baked into this design are the same ones the evidence recommends: a hard `MAX_TURNS` cap, an optional token budget, and self-judged completion that requires concrete evidence rather than a bare "done." Those guardrails are what make unattended multi-turn execution viable instead of a runaway loop, so they ship as part of the capability rather than as later polish.

## What Changes

- Add a `goal_system` capability: a single active goal per session that drives autonomous multi-turn execution toward a defined objective.
- Add a `/goal <objective>` slash command that sets (or replaces) the session's active goal, with an optional token budget supplied at creation time.
- Add a `goal_complete` tool that transitions the active goal to `complete` only when the model supplies completion evidence; this tool is disabled for subagent sessions.
- Hook an auto-continuation check into the runloop early-exit path: while a goal is `active`, emit a synthetic continuation message that drives the next turn instead of waiting for human input.
- Mark continuation messages as synthetic so the TUI hides them from the rendered transcript.
- Enforce guards: a `MAX_TURNS` hard cap (default 200) and an optional token budget. Hitting either transitions the goal to `budget_limited` and auto-pauses execution.
- Define a goal state machine: `active` to `complete` (via `goal_complete`), `active` to `budget_limited` (cap or budget hit), `active` to `paused` (manual pause). A new `/goal` replaces any prior goal regardless of its state.
- Inject the goal status into the dynamic (uncached) section of the system prompt only (Active Goal text, `Turns: N/200 | Status: active`, and a completion reminder), so it never invalidates the cached prompt prefix. This ties into the `prompt-cache-stability` capability.
- Preserve the model variant when a goal auto-resumes after a push-to-background.
- Gate the entire feature behind `experimental.goal_system` (default `false`). No behavior changes for users who do not opt in.
- **BREAKING**: none. The feature is opt-in via `experimental.goal_system`, default off.

## Capabilities

### New Capabilities

- `goal-system`: Autonomous multi-turn execution toward a single defined objective per session. `/goal` sets the objective and an optional token budget, the agent self-continues via synthetic messages hidden from the TUI, goal status is injected into the dynamic prompt section, and execution stops when the model calls `goal_complete` with evidence or a guard (MAX_TURNS cap, token budget) transitions the goal to `budget_limited` and pauses it.

### Modified Capabilities

None — opt-in, default off.

## Impact

- Affected code: `packages/core/src/config/experimental.ts` (config flag), `packages/core/src/session/` (goal state model, storage, runloop early-exit continuation hook, synthetic continuation messages), `packages/core/src/system-context/` (dynamic goal-status injection), `packages/core/src/tool/` (`goal_complete` tool plus registry gating for subagents), `packages/opencode` (`/goal` slash command), `packages/tui` (hide synthetic continuation messages).
- Affected users: only those who set `experimental.goal_system: true`; all others keep today's single-turn, human-driven behavior.
- Risk surface: contained behind a default-false experimental flag, and bounded at runtime by the MAX_TURNS cap, the optional token budget, and the evidence-gated completion tool.
