# persistent-memory Specification

## ADDED Requirements

### Requirement: memory_persist Tool

The system SHALL expose a `memory_persist(name, type, content)` tool that the agent can call to save a fact to persistent memory, where `name` identifies the memory, `type` is one of the supported types, and `content` is the body to store.

#### Scenario: agent persists a fact
- **WHEN** the agent calls `memory_persist` with a `name`, a valid `type`, and `content`
- **THEN** a persistent memory entry is created on disk and is available for injection on subsequent session starts

### Requirement: Markdown File Storage With Frontmatter

Each persistent memory SHALL be stored as a markdown file under `~/.local/share/opencode/memory/`, and every file MUST begin with frontmatter containing `name`, `type`, and `created`.

#### Scenario: a persisted memory is written as a frontmatter markdown file
- **WHEN** `memory_persist` saves a memory
- **THEN** a markdown file is written under `~/.local/share/opencode/memory/` whose frontmatter contains `name`, `type`, and `created`, followed by the content body

#### Scenario: malformed frontmatter is skipped on read
- **WHEN** a file in the memory directory has missing or unparseable frontmatter
- **THEN** that file is skipped during injection and does not abort loading of the remaining valid memories

### Requirement: Three Memory Types

Persistent memory SHALL support exactly three types: `user` for preferences, `project` for codebase facts, and `feedback` for corrections, and a `memory_persist` call with any other type MUST be rejected.

#### Scenario: a supported type is accepted
- **WHEN** `memory_persist` is called with `type` equal to `user`, `project`, or `feedback`
- **THEN** the memory is saved with that type recorded in its frontmatter

#### Scenario: an unsupported type is rejected
- **WHEN** `memory_persist` is called with a `type` outside `user`, `project`, and `feedback`
- **THEN** the call is rejected with a clear error and no file is written

### Requirement: Injection As persistent-memory Block On Session Start

Persistent memory SHALL be injected into the system prompt as a `<persistent-memory>` block on every session start, rendering the loaded memories so the agent can reference them. When `experimental.prompt_split_caching` is enabled, the `<persistent-memory>` block MUST be emitted in the dynamic suffix (see prompt-cache-stability) rather than the cached prefix; when it is disabled, it is injected at its existing position with no change.

#### Scenario: memories are injected at session start
- **WHEN** a session starts and one or more valid persistent memories exist
- **THEN** the assembled system prompt contains a `<persistent-memory>` block rendering those memories

#### Scenario: no memories means no block
- **WHEN** a session starts and no persistent memories exist
- **THEN** no `<persistent-memory>` block is added and the prompt matches the no-memory baseline

### Requirement: File And Line Limits With Newest-First

Persistent memory storage SHALL be capped at 200 memory files, and injection SHALL be capped at 500 lines; when either limit is reached, the system MUST keep the newest entries first and drop the oldest from injection.

#### Scenario: injection is capped at 500 lines newest-first
- **WHEN** the combined persistent memories would exceed 500 injected lines
- **THEN** the `<persistent-memory>` block includes the newest memories up to 500 lines and omits the older ones beyond the cap

#### Scenario: file count is capped at 200 newest-first
- **WHEN** persisting would push the on-disk memory file count above 200
- **THEN** the store retains the 200 newest files and the oldest are not kept for injection

### Requirement: Write Validation, Temporal Decay, And Scoped Retrieval

Persistent memory SHALL validate every write before it is persisted, prune stale entries through temporal decay, and relevance-gate retrieval at injection time, so that memory poisoning, staleness, and context bloat are mitigated.

#### Scenario: an invalid write is rejected before persisting
- **WHEN** a `memory_persist` call fails validation (for example missing required fields, oversized content, or disallowed content)
- **THEN** the write is rejected with a clear error and no memory file is created

#### Scenario: stale entries decay out of injection
- **WHEN** a persistent memory has aged past its decay threshold without reinforcement
- **THEN** it is pruned or demoted so it is not injected, keeping the injected set fresh

#### Scenario: injection is relevance-gated
- **WHEN** persistent memories are selected for injection
- **THEN** only entries relevant to the current session are included, bounded by the 500-line cap, rather than injecting every stored memory unconditionally
