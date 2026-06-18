# Design: Goal System

## Context

The V2 session runloop in `packages/core/src/session/` runs an assistant turn and then reaches an early-exit path where, absent more work, it stops and waits for fresh human input. There is no first-class notion of a standing objective that survives across turns. System prompts are assembled through the system-context registry (`packages/core/src/system-context/`), which combines registered entries into the prompt; the `prompt-cache-stability` work establishes a cached prefix plus a dynamic (uncached) tail so that per-turn-volatile text does not bust the provider cache. Tools are assembled per session in `packages/core/src/tool/registry.ts`, which already distinguishes session kinds and is the natural gating point for subagents. Experimental flags live in `packages/core/src/config/experimental.ts`, and slash commands live in `packages/opencode`.

The goal system ported from opencode-x (commits bb9f0d546, 929ceb34f, 563856741, 98208905f) layers autonomous multi-turn execution on top of this: `/goal` sets one objective per session, the runloop early-exit emits a synthetic continuation message while the goal is `active`, and the loop ends when the model calls `goal_complete` with evidence or a guard fires.

The evidence on autonomy is the design constraint, not a footnote. Agent reliability decays with task length (roughly 100% under 4 minutes, under 10% past 4 hours), and goal drift grows as context grows. That is why the cap, the optional token budget, and evidence-gated self-completion are core to the capability rather than optional add-ons.

## Goals / Non-Goals

Goals:
- Drive autonomous multi-turn execution toward a single per-session objective.
- Stop deterministically: model calls `goal_complete` with evidence, or a guard (MAX_TURNS, token budget) fires.
- Keep goal status out of the cached prompt prefix so it never invalidates the cache.
- Hide auto-continuation messages from the TUI.
- Gate the whole feature behind `experimental.goal_system`, default off.
- Preserve the model variant across background auto-resume.

Non-Goals:
- Multiple concurrent goals per session (exactly one active goal; a new `/goal` replaces it).
- Exposing autonomous goal completion to subagents.
- Cross-session or global goal orchestration.
- Persisting goal state across full process restarts beyond what the session store already provides.
- Replacing the existing single-turn, human-driven default path for non-opted-in users.

## Decisions

### Where the continuation hook sits in the runloop
The continuation check lives at the runloop early-exit path, the same point where a turn would otherwise stop and wait for human input. When the session has an `active` goal and no guard has fired, the early-exit emits a synthetic continuation message that starts the next turn. Placing the hook at early-exit (rather than inside tool dispatch) keeps the autonomous loop a thin wrapper over the normal turn lifecycle and means a turn that has real pending work still completes that work first.

### Goal state machine and storage
States: `active`, `complete`, `budget_limited`, `paused`. Transitions: `active` to `complete` (via `goal_complete` with evidence), `active` to `budget_limited` (MAX_TURNS cap hit or token budget exceeded), `active` to `paused` (manual pause via `/goal pause`), `paused` to `active` (manual resume via `/goal resume`), and `budget_limited` to `active` (manual resume that also raises the exhausted MAX_TURNS or token budget; resuming without raising the limit leaves it `budget_limited` because it would immediately re-trip the guard). `paused` is user-initiated; `budget_limited` is guard-initiated. A new `/goal` replaces any goal in any state with a fresh `active` goal and resets the turn counter. State is stored as immutable per-session goal data: the objective text, optional token budget, turn counter, cumulative token usage, model variant, and status. Updates produce a new goal record rather than mutating the prior one.

### Dynamic-vs-cached prompt placement
The goal status (Active Goal text, `Turns: N/200 | Status: active`, and the "call goal_complete with evidence" reminder) is injected only into the dynamic (uncached) section, registered through the system-context registry. This ties directly into `prompt-cache-stability`: the turn counter and status change every turn, so placing them in the cached prefix would bust the cache on every single turn. Keeping them dynamic means the cached prefix stays byte-identical across the whole run.

### Default MAX_TURNS = 200
The hard cap defaults to 200 turns, matching the ported value. It is a deterministic backstop independent of the optional token budget, so a goal always terminates even when no token budget is set. Reaching the cap transitions the goal to `budget_limited` and stops continuation.

### Evidence requirement on completion
`goal_complete` requires the model to pass completion evidence; a call without evidence is rejected and leaves the goal `active`. This guards against premature self-declared success, which is the dominant failure mode of self-judged completion. The tool is registered only for primary sessions; the registry omits it for subagents.

### Alternatives considered
- Unbounded autonomous loop (no cap, no budget, no evidence): rejected. Given the reliability-decay and goal-drift evidence, an unbounded loop becomes both unreliable and a runaway-cost risk. The caps and the evidence gate are precisely the recommended mitigations and are what make the feature shippable.
- Injecting goal status into the cached prefix: rejected because the per-turn turn counter would invalidate the cache every turn, defeating `prompt-cache-stability`.
- Showing continuation messages in the TUI: rejected; they are machine-generated scaffolding and would clutter the human-readable transcript, so they are marked synthetic and hidden.

## Risks / Trade-offs

- [Risk] Goal drift on long runs: as context grows the model loses sight of the original objective. Mitigation: the MAX_TURNS cap and optional token budget bound run length, and the goal status is re-injected into the dynamic prompt section every turn. Recommended addition: re-anchor the goal at compaction points so the objective survives summarization and counters drift directly.
- [Risk] Runaway cost from autonomous turns: an agent could burn tokens indefinitely. Mitigation: the MAX_TURNS hard cap (default 200) plus the optional token budget, either of which transitions the goal to `budget_limited` and auto-pauses; both are guardrails enforced at the runloop level, not advisory.
- [Risk] False self-completion: the model declares success before the objective is met. Mitigation: `goal_complete` requires concrete evidence and rejects evidence-free calls, so completion is gated on a substantiated claim rather than a bare assertion.
- [Trade-off] Synthetic continuation messages are hidden from the TUI, which improves transcript readability but means the human sees fewer of the loop's internal seams; the goal status line in the prompt and the turn counter keep the run observable.

## Open Questions

- What is the exact re-anchoring mechanism at compaction points (re-inject the objective verbatim, or a summarized restatement)?
- Resolved: a `budget_limited` goal is resumable in place via `/goal resume`, but only when the resume raises the exhausted MAX_TURNS or token budget; otherwise it stays `budget_limited` (see the spec requirement "Manual Pause And Resume").
- Should the optional token budget count only model tokens or include tool-output tokens toward the budget?
- Resolved: `/goal pause` and `/goal resume` are the affordances (see the spec requirement "Manual Pause And Resume"); the exact TUI surfacing of a `paused`/`budget_limited` goal is a UI detail left to implementation.
