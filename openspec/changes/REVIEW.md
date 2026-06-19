# OpenSpec Review Tracker

Review state for each active change. Source of truth is the `review:` field in
each change's `.openspec.yaml`; this table mirrors it for an at-a-glance view.

Valid states: `open` (not yet reviewed) -> `changes-requested` (feedback to
handle) -> `addressed` (cleared to implement). See AGENTS.md, section "OpenSpec
Review Tracking", for the full workflow.

| change | review | updated | notes |
|---|---|---|---|
| subscription-usage-tracker | open | 2026-06-18 | initial tracker bootstrap |
| context-safety-net | changes-requested | 2026-06-18 | X2: added "Compaction pipeline order" requirement; message-unit and retry-cap gaps remain (MEDIUM) |
| sliding-window-compaction | changes-requested | 2026-06-18 | SW1: cut keeps tool-call/result pairs together; SW2: MIN defined, trim oldest |
| prompt-cache-stability | changes-requested | 2026-06-18 | PC1: 1h TTL gated behind the flag to resolve the BREAKING:None contradiction |
| background-subagents | changes-requested | 2026-06-18 | BG1: parent-termination ownership; BG2: added cancelled terminal state |
| swarm-mode | addressed | 2026-06-18 | SM1: per-item timeout so a hung item never blocks the swarm |
| orchestration-guardrails | changes-requested | 2026-06-18 | OG1: doom-loop cap = 1000 calls/root; OG3: descendant cap now concurrent |
| agent-memory | changes-requested | 2026-06-18 | AM1: enforced agent-scope seam for subagent exclusion; decay/relevance/caps remain (MEDIUM) |
| goal-system | changes-requested | 2026-06-18 | GS1: state machine completed with manual pause/resume and budget_limited resume path |
| hybrid-model-routing | changes-requested | 2026-06-18 | HM2/HM4 (MEDIUM): compression determinism + tool-output pipeline ordering noted in design |
