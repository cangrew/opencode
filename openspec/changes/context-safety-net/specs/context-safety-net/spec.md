## ADDED Requirements

### Requirement: Tool Result Budget (Tier 1)

When `experimental.tool_result_budget` is configured to a positive character count, the system SHALL enforce a global budget over the total characters of all tool-result outputs currently in the message history. When the combined tool-result character count exceeds the budget, the system MUST replace the oldest tool results, in order from oldest to newest, with the literal string `[tool result truncated to save context]` until the remaining tool-result characters fit within the budget. Tier 1 MUST NOT call any model and MUST NOT mutate the original messages in place; it produces a reduced copy of the history for the outgoing request. When the flag is unset, the system SHALL leave tool results unchanged.

#### Scenario: Budget not exceeded leaves tool results intact

- **WHEN** `experimental.tool_result_budget` is set and the combined tool-result characters in history are at or below the budget
- **THEN** the system sends every tool result verbatim and truncates nothing

#### Scenario: Oldest tool results truncated when budget exceeded

- **WHEN** `experimental.tool_result_budget` is set and the combined tool-result characters exceed the budget
- **THEN** the system replaces the oldest tool results with the literal string `[tool result truncated to save context]` until the remaining tool-result characters fit within the budget, leaving the newest tool results intact

#### Scenario: Budget disabled when flag unset

- **WHEN** `experimental.tool_result_budget` is unset or not a positive number
- **THEN** the system applies no tool-result budget and sends all tool results unchanged

### Requirement: MicroCompact at 75% utilization (Tier 2)

When `experimental.microcompact` is enabled, the system SHALL compute utilization as `input_tokens / context_window` for the prepared request and, when utilization is `>= 0.75`, summarize the older messages while keeping the 10 most recent messages verbatim. The summarization MUST use the cheap model from hybrid routing when one is configured, otherwise the session model. When the flag is disabled or utilization is below `0.75`, the system MUST NOT micro-compact.

#### Scenario: MicroCompact triggers at the 75% threshold

- **WHEN** `experimental.microcompact` is enabled and request utilization (`input_tokens / context_window`) is `>= 0.75`
- **THEN** the system summarizes the older messages and keeps the 10 most recent messages verbatim in the outgoing request

#### Scenario: MicroCompact prefers the cheap model

- **WHEN** MicroCompact runs and a cheap model is configured via hybrid routing
- **THEN** the system performs the summarization with the cheap model rather than the session model

#### Scenario: MicroCompact falls back to the session model

- **WHEN** MicroCompact runs and no cheap model is configured
- **THEN** the system performs the summarization with the session model

#### Scenario: Below threshold does not micro-compact

- **WHEN** `experimental.microcompact` is enabled but utilization is below `0.75`
- **THEN** the system leaves the message history unchanged and performs no summarization

### Requirement: Context Collapse at 97% utilization (Tier 3)

When `experimental.context_collapse` is enabled and utilization (`input_tokens / context_window`) reaches `>= 0.97`, the system SHALL perform an emergency collapse. It MUST first back up the full message history to a file under `~/.local/share/opencode/log/collapse/` before any messages are removed. It MUST then replace all messages with a structured summary plus the last user message. If summarization fails, the system MUST fall back to keeping only the last 4 messages. When the flag is disabled or utilization is below `0.97`, the system MUST NOT collapse.

#### Scenario: Collapse triggers at the 97% threshold

- **WHEN** `experimental.context_collapse` is enabled and request utilization is `>= 0.97`
- **THEN** the system performs an emergency context collapse before sending the request

#### Scenario: Full history backed up to disk before collapse

- **WHEN** a context collapse begins
- **THEN** the system writes the full pre-collapse message history to a file under `~/.local/share/opencode/log/collapse/` before removing or replacing any messages

#### Scenario: Messages replaced with summary plus last user message

- **WHEN** a context collapse summarization succeeds
- **THEN** the system replaces all messages with a structured summary followed by the last user message

#### Scenario: Keep-last-4 fallback when summarization fails

- **WHEN** a context collapse is triggered but the summarization call fails
- **THEN** the system keeps only the last 4 messages and discards the rest, without raising the failure to the user

#### Scenario: Below threshold does not collapse

- **WHEN** `experimental.context_collapse` is enabled but utilization is below `0.97`
- **THEN** the system performs no collapse and leaves the message history unchanged

### Requirement: Reactive 413 context-overflow recovery

The system SHALL detect a provider context-overflow error (HTTP 413 with a "prompt too long" indication) returned for a request and recover by compacting the history and retrying the request. The retry MUST reserve a token floor (default approximately 20,000 tokens) below the model's context window so the compacted request does not immediately re-overflow. The system MUST cap the number of recovery retries for a single request so it cannot loop indefinitely, and MUST surface the error to the user if the retry cap is reached without success.

#### Scenario: 413 overflow triggers compact-and-retry

- **WHEN** a request returns an HTTP 413 "prompt too long" context-overflow error
- **THEN** the system compacts the message history and retries the request

#### Scenario: Reserve-token floor applied on retry

- **WHEN** the system compacts in response to a 413 overflow
- **THEN** it targets a compacted size that leaves at least the reserve-token floor (default approximately 20,000 tokens) of headroom below the context window so the retried request does not immediately overflow again

#### Scenario: Retry cap prevents infinite loops

- **WHEN** repeated retries for the same request continue to return a 413 overflow up to the retry cap
- **THEN** the system stops retrying and surfaces the context-overflow error to the user instead of looping

#### Scenario: Reactive path independent of proactive flags

- **WHEN** a 413 overflow occurs and the proactive tier flags are disabled
- **THEN** the reactive recovery still compacts and retries, because token estimation can cross the real limit before any proactive tier fires

### Requirement: Compaction pipeline order

When more than one compaction mechanism is enabled, the system SHALL apply them in a single deterministic order for a prepared request, and at most one summarizing strategy MUST act on a given request. The order is: (1) Tier 1 Tool Result Budget (pure truncation, no model call); (2) compute the utilization estimate once on the post-Tier-1 history; (3) exactly one summarizing strategy when triggered, chosen as sliding-window compaction when it is enabled and over its threshold, otherwise Tier 2 MicroCompact when utilization is `>= 0.75`, otherwise the legacy hard-truncation path; (4) Tier 3 Context Collapse only as the `>= 0.97` emergency last resort; (5) the reactive 413 recovery path if the provider still rejects the sent request. The summarizing strategies MUST be mutually exclusive on a single request: the same prepared request MUST NOT be summarized by more than one of sliding-window, Tier 2, and legacy hard-truncation.

#### Scenario: Tool Result Budget runs before utilization is computed

- **WHEN** Tier 1 is configured and a request is prepared
- **THEN** Tier 1 truncation is applied first, and the utilization estimate that gates Tier 2 and Tier 3 is computed on the post-Tier-1 history

#### Scenario: Sliding-window is the single summarizer when enabled

- **WHEN** both sliding-window compaction and Tier 2 MicroCompact are enabled and a request crosses the summarization point
- **THEN** sliding-window is the single summarizing strategy for that request and Tier 2 does not also summarize the same request

#### Scenario: Tier 3 is the last-resort emergency only

- **WHEN** a request is still at `>= 0.97` utilization after the chosen summarizing strategy has run
- **THEN** Tier 3 Context Collapse runs as the final proactive step, and the reactive 413 path remains available if the provider still rejects the sent request
