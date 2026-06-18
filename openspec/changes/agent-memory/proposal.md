# Agent Memory (Session + Persistent)

## Why

opencode today carries no durable memory: every session starts cold, and anything the user or agent learned is lost on `/clear`, on compaction, or at restart. Porting the opencode-x "agent memory" feature (canonical commit `5cd15b9d5` plus the persistent-memory tool) gives two complementary tiers: a user-curated SESSION memory that survives `/clear` and `/clear-compact` within a session, and an agent-curated PERSISTENT memory that survives restarts across sessions.

The value is not code quality. The first controlled coding-memory benchmark found memory does NOT improve code quality, but it cuts roughly 22-32% of cost and 28-40% of turns on complex tasks (while being pure overhead on simple ones). So memory is justified as a cost/turn reduction on complex, repeated work, not as a quality lever, and it must avoid bloating simple sessions.

Memory is also an attack surface. The same research shows memory poisoning achieves >95% injection success and persists across sessions. Persistent memory therefore MUST validate writes, prune stale entries (temporal decay), and scope retrieval, and injection MUST be relevance-gated so it does not silently bloat or hijack the system prompt.

## What Changes

- Add a per-session SESSION memory store in SQLite, tied to the session row, with user-facing CRUD via `/memory_add`, `/memory_edit`, and `/memory_delete` slash commands plus TUI dialogs.
- Inject session memory as a labeled `Session Memory:` block into the PRIMARY agent's system prompt only; subagents never receive it.
- Make session memory survive `/clear` and `/clear-compact`; it is removed only when the owning session is deleted.
- Add a `memory_persist(name, type, content)` tool the agent uses to save facts as markdown files under `~/.local/share/opencode/memory/` with frontmatter (`name`, `type`, `created`).
- Inject persistent memory as a `<persistent-memory>` block at session start, enforcing a max of 200 memory files and a max of 500 injected lines, newest-first when the limit is reached.
- Support three persistent memory types: `user` (preferences), `project` (codebase facts), `feedback` (corrections).
- Validate persistent writes, apply temporal decay to prune stale entries, and relevance-gate injection to bound context growth.
- No **BREAKING** changes. Both tiers are additive: with no memories present, system prompts are unchanged.

## Capabilities

### New Capabilities

- `session-memory`: per-session, user-curated memory stored in SQLite tied to the session, managed via `/memory_add` / `/memory_edit` / `/memory_delete`, surviving `/clear` and `/clear-compact`, injected as a `Session Memory:` block into the primary agent's system prompt only.
- `persistent-memory`: cross-session, agent-curated memory written by the `memory_persist` tool as markdown files with frontmatter under `~/.local/share/opencode/memory/`, typed (`user` / `project` / `feedback`), injected as a `<persistent-memory>` block at session start under 200-file / 500-line newest-first limits, with write validation, temporal decay, and relevance-gated retrieval.

### Modified Capabilities

None.

## Impact

- **Packages**: `packages/core` (Drizzle `session_memory` table + migration, session-memory CRUD store, persistent-memory file store + `memory_persist` tool, frontmatter parse/write, `SystemContext` injection sources for both tiers with primary-vs-subagent gating, limit/decay/validation logic), `packages/opencode` (`/memory_add` / `/memory_edit` / `/memory_delete` slash commands, docs), `packages/tui` (add / edit / delete dialogs).
- **Data**: new `session_memory` SQLite table; new on-disk store at `~/.local/share/opencode/memory/` (markdown + frontmatter).
- **Prompt cache**: session and persistent memory are dynamic system-prompt sections; they tie into `prompt-cache-stability` so memory updates re-key the cache predictably rather than thrashing it.
- **Runtime**: with no memories present there is no behavioral change and no added prompt content. When present, injection is bounded by the 500-line cap and relevance gating to avoid context bloat.
