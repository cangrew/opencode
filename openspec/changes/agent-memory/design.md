# Design: Agent Memory (Session + Persistent)

## Context

opencode sessions start cold and lose all learned context on `/clear`, on compaction, and at restart. The opencode-x fork (canonical commit `5cd15b9d5` plus the persistent-memory tool) addresses this with two tiers: a user-curated SESSION memory persisted in SQLite per session, and an agent-curated PERSISTENT memory persisted as markdown files across sessions.

This port lands in `packages/core`, where the session runtime, the Drizzle + SQLite schema (snake_case columns), the `SystemContext` registry that assembles privileged system-prompt sources, and the tool registry already live. Slash commands surface in `packages/opencode`; add/edit/delete dialogs surface in `packages/tui`. The data directory is `~/.local/share/opencode/`.

The motivating evidence is narrow: the first controlled coding-memory benchmark found memory does not improve code quality, but reduces cost by roughly 22-32% and turns by 28-40% on complex tasks, while being pure overhead on simple ones. The same work shows memory is an attack surface (memory poisoning achieves >95% injection success and persists across sessions). The design therefore treats correctness of injection, bounded growth, and write safety as first-class, not the cleverness of retrieval.

## Goals / Non-Goals

Goals:
- Per-session user memory that survives `/clear` and `/clear-compact` and is deleted only with its session.
- Inject session memory into the primary agent only, never subagents.
- Agent-writable persistent memory as typed markdown-with-frontmatter files, injected at session start.
- Enforce 200-file and 500-line caps, newest-first, with write validation, temporal decay, and relevance-gated injection.
- Additive behavior: no memories means byte-identical prompts.

Non-Goals:
- Promising a quality improvement; the value proposition is cost/turn reduction on complex work.
- Embedding-based or vector retrieval (relevance gating starts heuristic; vectors are a later option).
- Sharing memory across machines or syncing the on-disk store remotely.
- Auto-promoting session memory into persistent memory.

## Decisions

### Session memory: SQLite table tied to the session
Add a `session_memory` Drizzle table with snake_case columns following the existing `Timestamps` pattern (`time_created`, `time_updated`): `id` (primary key), `session_id` (references the session row), `content` (text). CRUD goes through an immutable store module (create returns a new row; edit writes a new content value; delete removes one row) and never mutates existing rows in place. Tying rows to `session_id` gives per-session isolation for free and makes deletion cascade with the session.

### Persistent memory: markdown + frontmatter file store
Persist each memory as a markdown file under `~/.local/share/opencode/memory/` with frontmatter `name`, `type`, `created`. Files are human-readable, diffable, and editable outside the tool, which matches how opencode already treats on-disk config. A small parse/write module owns frontmatter; malformed files are skipped on read rather than aborting load.

### Injection points: primary vs subagent, via SystemContext
Both tiers register as `SystemContext` sources so they compose with the existing privileged-context machinery. The session-memory source renders `Session Memory:\n- ...` and is admitted only for the primary agent; subagent prompt assembly omits it. The persistent-memory source renders the `<persistent-memory>` block at session start. Because both are dynamic prompt sections, they tie directly into `prompt-cache-stability`: memory edits must re-key the cache deterministically (stable ordering, stable rendering) so an edit invalidates exactly the affected prefix rather than thrashing the whole cache.

### Limit enforcement and newest-first
Persistent injection sorts newest-first and accumulates until the 500-line cap, then stops; remaining memories are omitted from injection (not deleted). On-disk file count is capped at 200 newest; older files beyond 200 are not retained for injection. Caps are named constants, not magic numbers.

### Write validation and temporal decay
Every `memory_persist` write is validated before any file is written: required fields present, type in `{user, project, feedback}`, content within a size bound, content screened for disallowed/injection-shaped payloads. Entries carry `created` (and reinforcement on re-write) so a decay function can prune or demote stale entries out of injection. Retrieval is relevance-gated so only entries pertinent to the current session enter the prompt, bounded by the line cap.

### Alternatives considered
A single unified memory store (one backend for both tiers) was rejected: session memory is user-curated, scoped to one session, and must die with it, while persistent memory is agent-curated, cross-session, and file-backed for out-of-band editing. Their lifecycles, owners, injection rules, and storage shapes differ enough that one store would couple unrelated concerns and complicate the primary-only injection rule. Two focused stores keep each module small and each rule local.

## Risks / Trade-offs

- Memory poisoning (>95% injection success, persists across sessions) → Mitigation: validate every persistent write before persisting, screen content, and record provenance (`created` plus type) so suspect entries can be traced and pruned.
- Staleness and context bloat → Mitigation: temporal decay prunes/demotes aged entries, relevance gating limits what is injected, and the hard 500-line cap bounds prompt growth regardless.
- No quality gain → Mitigation: set expectations in docs and UI copy. The value is cost/turn reduction on complex tasks; on simple tasks memory is overhead, so injection stays gated and additive.
- Prompt-cache churn from edits → Mitigation: deterministic ordering and rendering so an edit re-keys exactly the affected section, coordinated with `prompt-cache-stability`.
- Subagent leakage → Mitigation: session-memory injection is admitted only for the primary agent path; a test asserts subagent prompts contain no `Session Memory:` block.

## Open Questions

- What heuristic powers relevance gating at v1 (path/keyword scoping vs embeddings), and when do we graduate to vectors?
- What is the decay threshold and does re-write (reinforcement) reset it, or is decay purely age-based?
- When the 200-file cap is hit, do we delete the oldest files on disk or only exclude them from injection while leaving them archived?
- Should `feedback`-type memories outrank `user`/`project` in the newest-first ordering, or is ordering strictly chronological?
- Do `/memory_edit` and `/memory_delete` need multi-select, or is single-entry selection sufficient for v1?
