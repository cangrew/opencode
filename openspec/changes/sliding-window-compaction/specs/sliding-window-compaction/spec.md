## ADDED Requirements

### Requirement: Threshold Trigger

The system SHALL only engage sliding-window compaction when the strategy is enabled AND the estimated conversation token count exceeds the configured `compaction.sliding_window.threshold`. Below the threshold, history MUST be passed through unmodified.

#### Scenario: Below threshold passes through

- **WHEN** sliding-window compaction is enabled and the estimated token count is at or under `threshold`
- **THEN** the strategy MUST NOT split or summarize, and the request messages are sent verbatim

#### Scenario: Above threshold engages strategy

- **WHEN** sliding-window compaction is enabled and the estimated token count exceeds `threshold`
- **THEN** the strategy MUST split history into a summarized HEAD and a verbatim TAIL before the request is sent

### Requirement: Head/Tail Split by Tail Ratio

The system SHALL divide history into an older HEAD and a recent TAIL such that the TAIL targets `tail_ratio` of the available token budget, where HEAD is summarized and TAIL is preserved verbatim.

#### Scenario: Tail targets configured ratio

- **WHEN** the strategy splits a conversation with `tail_ratio` of 0.5
- **THEN** the verbatim TAIL MUST target approximately half of the available token budget and the remaining older messages MUST form the HEAD

#### Scenario: Tail preserved verbatim

- **WHEN** history is split into HEAD and TAIL
- **THEN** the TAIL messages MUST be included in the request unchanged, and only the HEAD MUST be replaced by its summary

### Requirement: Cut at Any Message Boundary

The system SHALL allow the HEAD/TAIL cut point to fall at any message boundary, not only at user-message boundaries. However, the cut MUST NOT separate a tool call from its corresponding tool result: when a candidate cut would place an assistant tool call in the summarized HEAD while its matching tool result remains in the verbatim TAIL (or the reverse), the system MUST move the cut to the nearest boundary that keeps every tool-call/tool-result pair wholly on one side of the split. This prevents the outgoing request from carrying a tool result whose originating tool call was dissolved into the summary, which strict providers (for example Anthropic) reject.

#### Scenario: Cut between non-user messages is allowed

- **WHEN** the budget-driven cut point falls between two non-user messages that do not break a tool-call/tool-result pair (for example a completed tool result and the following assistant message)
- **THEN** the strategy MUST place the cut at that boundary rather than forcing it back to the nearest user message

#### Scenario: Cut never orphans a tool result from its call

- **WHEN** the budget-driven cut point would place an assistant tool call in the HEAD while its corresponding tool result is in the TAIL (or the reverse)
- **THEN** the strategy MUST shift the cut so the tool call and its result stay together on one side, and the request sent to the provider MUST contain no tool result whose originating tool call was replaced by the summary

### Requirement: Summary Caching Keyed by Session and Head Boundary

The system SHALL cache the generated HEAD summary using a key composed of the session id and the head boundary, and MUST reuse the cached summary when both are unchanged.

#### Scenario: Cache hit reuses summary

- **WHEN** the strategy runs again for the same session id and the same head boundary
- **THEN** the cached summary MUST be reused and no new summarization request is issued

#### Scenario: Cache key includes session id

- **WHEN** two different sessions reach the same head boundary content
- **THEN** their summaries MUST be cached under distinct keys and MUST NOT collide

### Requirement: Summary Regeneration Only When Head Changes

The system SHALL regenerate the HEAD summary only when the head boundary changes; an unchanged head MUST NOT trigger a new summarization request.

#### Scenario: Head grows triggers regeneration

- **WHEN** new messages push older messages into the HEAD and the head boundary advances
- **THEN** the strategy MUST regenerate the summary for the new head boundary

#### Scenario: Head unchanged skips regeneration

- **WHEN** the strategy runs and the head boundary is identical to the previously summarized boundary
- **THEN** no summarization request MUST be issued and the existing summary is used

### Requirement: Budget Cap When Tail Spans Full Context

The system SHALL cap the budget to total-context-minus-MIN when the verbatim TAIL would otherwise span the entire context window, ensuring room remains for the summary and model output. MIN is the existing reserved buffer (`DEFAULT_BUFFER`, 20,000 tokens) combined with the model's reserved output allowance, so the cap tracks the same reservation the legacy compaction path already uses. When the TAIL is trimmed to fit the capped budget, the system MUST drop messages from the OLDEST end of the TAIL (moving them into the summarized HEAD), never from the newest end, so the highest-recall recent messages are preserved.

#### Scenario: Oversized tail is capped and trimmed from the oldest end

- **WHEN** the computed verbatim TAIL would consume the full context window
- **THEN** the budget MUST be capped to total context minus the reserved MIN (`DEFAULT_BUFFER` plus the reserved output allowance), and the TAIL MUST be trimmed from its oldest end to fit within the capped budget while the newest messages remain verbatim

### Requirement: Token Savings Tracked and Surfaced

The system SHALL track the per-session token savings produced by sliding-window compaction (tokens removed versus a verbatim send) and surface them in the TUI `/status` dialog and the sidebar context panel.

#### Scenario: Savings shown in status dialog

- **WHEN** sliding-window compaction has run for a session and the user opens the `/status` dialog
- **THEN** the dialog MUST display the per-session token savings for that session

#### Scenario: Savings shown in sidebar context panel

- **WHEN** sliding-window compaction has run for a session
- **THEN** the sidebar context panel MUST display the per-session token savings

### Requirement: Environment Variable Enable

The system SHALL enable sliding-window compaction when `OPENCODE_EXPERIMENTAL_SLIDING_WINDOW=1` is set, independently of the `compaction.sliding_window.enabled` config value.

#### Scenario: Env var enables strategy

- **WHEN** `OPENCODE_EXPERIMENTAL_SLIDING_WINDOW=1` is set and `compaction.sliding_window.enabled` is false
- **THEN** the sliding-window strategy MUST be active

#### Scenario: Default off without config or env var

- **WHEN** neither `compaction.sliding_window.enabled` nor the env var is set
- **THEN** the system MUST use the existing hard-truncation compaction path
