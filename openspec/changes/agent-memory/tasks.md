# Tasks: Agent Memory (Session + Persistent)

## 1. Session Memory Storage
- [ ] 1.1 Add a `session_memory` Drizzle table in `packages/core` with snake_case columns (`id`, `session_id`, `content`) reusing the existing `Timestamps` (`time_created`, `time_updated`) pattern, with `session_id` referencing the session row.
- [ ] 1.2 Write the Drizzle migration for the `session_memory` table and wire it into the migration set.
- [ ] 1.3 Implement an immutable session-memory store module (create / list-by-session / edit-content / delete-one) that never mutates existing rows in place and returns new values.
- [ ] 1.4 Ensure deleting a session removes its `session_memory` rows (cascade or explicit cleanup) so no orphan entries remain.

## 2. Session Memory Commands And Dialogs
- [ ] 2.1 Add the `/memory_add` slash command in `packages/opencode` that opens the add dialog and persists the entered text for the current session.
- [ ] 2.2 Add the `/memory_edit` slash command that lists entries, lets the user pick and edit one, and saves the new content.
- [ ] 2.3 Add the `/memory_delete` slash command that lists entries, lets the user pick one, and removes it.
- [ ] 2.4 Build the TUI add dialog in `packages/tui` for free-text entry with confirm/cancel.
- [ ] 2.5 Build the TUI edit dialog (entry picker plus editable text) in `packages/tui`.
- [ ] 2.6 Build the TUI delete dialog (entry picker plus confirm) in `packages/tui`.

## 3. Session Memory Injection
- [ ] 3.1 Register a `SystemContext` source that renders `Session Memory:\n- <entry>` with deterministic ordering for stable prompt-cache keying.
- [ ] 3.2 Admit the session-memory source only on the primary agent path via an explicit agent-scope input to the prompt-assembly path (a structural seam, not convention), so no spawn path (Task, swarm, or future) can leak it into a subagent prompt.
- [ ] 3.3 Emit no `Session Memory:` block when the session has zero entries (byte-identical to the no-memory baseline).
- [ ] 3.4 Verify session memory injection is unaffected by `/clear` and `/clear-compact` (entries persist and keep injecting).

## 4. Persistent Memory File Store
- [ ] 4.1 Implement the on-disk store rooted at `~/.local/share/opencode/memory/` with read-all and write-one operations.
- [ ] 4.2 Implement frontmatter parse (read) and write that round-trips `name`, `type`, `created` plus the content body.
- [ ] 4.3 Skip files with missing or unparseable frontmatter on read without aborting the load of valid files.

## 5. memory_persist Tool
- [ ] 5.1 Register the `memory_persist(name, type, content)` tool in the core tool registry.
- [ ] 5.2 Restrict `type` to exactly `user`, `project`, `feedback`; reject any other type with a clear error and no file write.
- [ ] 5.3 On a valid call, write the markdown-with-frontmatter file via the file store.

## 6. Persistent Memory Injection And Limits
- [ ] 6.1 Register a `SystemContext` source that renders the `<persistent-memory>` block at session start.
- [ ] 6.2 Sort newest-first and accumulate entries up to the 500-line cap (named constant), omitting the rest from injection.
- [ ] 6.3 Cap on-disk file count at 200 (named constant), retaining the 200 newest for injection.
- [ ] 6.4 Emit no `<persistent-memory>` block when no valid memories exist.

## 7. Write Validation, Decay, And Scoping
- [ ] 7.1 Validate every `memory_persist` write before persisting (required fields, type, content size bound, disallowed/injection-shaped content) and reject failures with no file written.
- [ ] 7.2 Record provenance (`created`, type, reinforcement on re-write) to support tracing and pruning suspect entries.
- [ ] 7.3 Implement temporal decay that prunes or demotes aged entries out of injection.
- [ ] 7.4 Implement relevance gating so only entries pertinent to the current session are injected, bounded by the line cap.

## 8. Prompt Cache Coordination
- [ ] 8.1 Ensure deterministic ordering and rendering for both memory sources so an edit re-keys exactly the affected prefix, coordinated with `prompt-cache-stability`.

## 9. Tests
- [ ] 9.1 Unit tests for the session-memory store: create / list / edit / delete and per-session isolation.
- [ ] 9.2 Unit tests for frontmatter parse/write round-trip and malformed-file skipping.
- [ ] 9.3 Unit tests for limit enforcement: 500-line newest-first injection cap and 200-file cap.
- [ ] 9.4 Unit tests for write validation (rejected type, oversized/disallowed content) and temporal decay.
- [ ] 9.5 Integration test: session memory survives `/clear` and `/clear-compact` and is deleted with its session.
- [ ] 9.6 Integration test: session memory injected for the primary agent but absent from subagent prompts.
- [ ] 9.7 Integration test: `memory_persist` writes a file that is injected as `<persistent-memory>` on the next session start.

## 10. Documentation
- [ ] 10.1 Document the `/memory_add` / `/memory_edit` / `/memory_delete` commands and the `memory_persist` tool, including types and limits.
- [ ] 10.2 Document the cost/turn (not quality) value proposition and the poisoning/staleness/bloat mitigations so expectations are set correctly.
