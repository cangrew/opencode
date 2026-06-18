# session-memory Specification

## ADDED Requirements

### Requirement: Add Session Memory Entry

The system SHALL provide a `/memory_add` slash command that opens a TUI dialog for the user to enter free text, and on confirmation MUST persist that text as a new session memory entry tied to the current session.

#### Scenario: user adds an entry via the add dialog
- **WHEN** the user runs `/memory_add`, types an entry, and confirms the dialog
- **THEN** the entry is stored as a new session memory row tied to the current session and becomes visible to subsequent edits and injection

### Requirement: Edit Session Memory Entry

The system SHALL provide a `/memory_edit` slash command that lets the user pick an existing session memory entry and edit its text, and on confirmation MUST replace that entry's content without mutating other entries.

#### Scenario: user edits an existing entry
- **WHEN** the user runs `/memory_edit`, selects an entry, changes its text, and confirms
- **THEN** that entry's content is updated to the new text and all other entries remain unchanged

### Requirement: Delete Session Memory Entry

The system SHALL provide a `/memory_delete` slash command that lets the user pick an existing session memory entry and remove it, and on confirmation MUST delete only the selected entry.

#### Scenario: user deletes a selected entry
- **WHEN** the user runs `/memory_delete`, selects an entry, and confirms
- **THEN** that entry is removed from the session and no longer appears in injection, while other entries remain

### Requirement: SQLite Storage Tied To Session

Session memory entries SHALL be stored in a SQLite table whose rows reference the owning session, so that each session's entries are isolated from every other session's entries.

#### Scenario: entries are scoped to their owning session
- **WHEN** a session memory entry is created in session A
- **THEN** it is associated only with session A and does not appear when injecting or listing entries for any other session

#### Scenario: deleting the session removes its entries
- **WHEN** a session that owns memory entries is deleted
- **THEN** that session's memory entries are removed and are not retained anywhere

### Requirement: Survives Clear And Clear-Compact

Session memory entries SHALL persist across the `/clear` and `/clear-compact` operations and MUST be removed only when the owning session itself is deleted.

#### Scenario: entries survive /clear
- **WHEN** the user runs `/clear` on a session that has memory entries
- **THEN** the conversation history is cleared but every session memory entry is still present and is still injected on the next turn

#### Scenario: entries survive /clear-compact
- **WHEN** the user runs `/clear-compact` on a session that has memory entries
- **THEN** the history is compacted but every session memory entry remains intact and continues to be injected

### Requirement: Inject Only For Primary Agent

Session memory SHALL be injected into the PRIMARY agent's system prompt as a labeled block beginning with `Session Memory:` followed by each entry on its own `- ` line, and MUST NOT be injected into any subagent's system prompt. When `experimental.prompt_split_caching` is enabled, this block MUST be emitted in the dynamic suffix (see prompt-cache-stability) rather than the cached prefix; when it is disabled, the block is injected at its existing position with no change.

#### Scenario: primary agent receives the session memory block
- **WHEN** the primary agent's system prompt is assembled for a session that has entries
- **THEN** the prompt contains a `Session Memory:` block listing each entry as a `- ` bullet

#### Scenario: subagents do not receive session memory
- **WHEN** a subagent's system prompt is assembled for a session that has entries
- **THEN** the subagent prompt contains no `Session Memory:` block and none of the session memory entries

#### Scenario: no entries means no block
- **WHEN** the primary agent's system prompt is assembled for a session with zero entries
- **THEN** no `Session Memory:` block is added and the prompt is unchanged from the no-memory baseline

### Requirement: Agent-Scope Enforcement For Memory Injection

The decision to inject session memory SHALL be driven by an explicit agent scope (primary vs subagent) passed into the system-prompt assembly path, so the primary-only rule is enforced structurally at the injection seam rather than by convention. Subagent prompts MUST never include session memory regardless of how the subagent was spawned (Task tool, swarm, or any future spawn path).

#### Scenario: subagent spawned by any path never receives session memory
- **WHEN** a subagent system prompt is assembled, whether the subagent was spawned by the Task tool, a swarm, or another spawn path
- **THEN** the assembly path receives a non-primary agent scope and emits no `Session Memory:` block for that subagent
