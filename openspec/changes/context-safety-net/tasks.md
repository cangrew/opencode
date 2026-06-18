# Tasks: Three-Tier Context Safety Net

## 1. Config schema

- [ ] 1.1 Add `experimental.tool_result_budget` (positive integer, character count; unset = disabled) to the experimental config schema in `packages/core`.
- [ ] 1.2 Add `experimental.microcompact` (boolean, default `false`) to the experimental config schema.
- [ ] 1.3 Add `experimental.context_collapse` (boolean, default `false`) to the experimental config schema.
- [ ] 1.4 Validate the three flags at the config boundary (reject non-positive budgets, non-boolean toggles) with clear error messages, and confirm all-unset means no behavior change.

## 2. Utilization calculation

- [ ] 2.1 Add a shared helper that computes utilization as `input_tokens / context_window` for a prepared request, reusing `Token.estimate` (`chars/4`) over the projected message list.
- [ ] 2.2 Expose the model's `context_window` to the helper and guard against a zero or missing window (treat as no proactive trigger).
- [ ] 2.3 Compute utilization once per request after Tier 1 runs, and pass it to the Tier 2 and Tier 3 gates.
- [ ] 2.4 Enforce the single compaction pipeline order (Tier 1 -> utilization -> exactly one summarizing strategy: sliding-window when enabled and over its threshold, else Tier 2, else legacy hard-truncation -> Tier 3 -> reactive 413), ensuring no single prepared request is summarized by more than one strategy.

## 3. Tier 1 — Tool Result Budget

- [ ] 3.1 Implement a pure transform that sums tool-result characters across the projected history and, when over budget, replaces the oldest tool results with the literal `[tool result truncated to save context]` until within budget.
- [ ] 3.2 Ensure the transform returns a new reduced history (immutable; no in-place mutation) and is a no-op when the flag is unset or the budget is not exceeded.
- [ ] 3.3 Hook Tier 1 as the first synchronous step in request preparation, before utilization is computed.

## 4. Tier 2 — MicroCompact

- [ ] 4.1 Gate MicroCompact on `experimental.microcompact` enabled and utilization `>= 0.75`.
- [ ] 4.2 Summarize older messages while keeping the 10 most recent messages verbatim; produce a new history with the summary in place of the older messages.
- [ ] 4.3 Resolve the summarization model: prefer the hybrid-routing cheap model when configured, else the session model.
- [ ] 4.4 Ensure MicroCompact is a no-op below `0.75` or when disabled.

## 5. Tier 3 — Context Collapse

- [ ] 5.1 Gate Context Collapse on `experimental.context_collapse` enabled and utilization `>= 0.97`.
- [ ] 5.2 Before removing any messages, write the full pre-collapse history to a file under `~/.local/share/opencode/log/collapse/` (create the directory if absent; use `Bun.file`/Bun write APIs).
- [ ] 5.3 On successful summarization, replace all messages with the structured summary plus the last user message.
- [ ] 5.4 On summarization failure, fall back to keeping only the last 4 messages, without surfacing the failure to the user.
- [ ] 5.5 Ensure collapse is a no-op below `0.97` or when disabled.

## 6. Reactive 413 recovery

- [ ] 6.1 Detect provider context-overflow errors (HTTP 413 "prompt too long") at the LLM call site / `packages/llm` boundary.
- [ ] 6.2 On detection, compact the history and retry the request.
- [ ] 6.3 Apply a reserve-token floor (default ~20,000) so the compacted request targets meaningfully below the context window.
- [ ] 6.4 Cap recovery retries per request; on reaching the cap, surface the context-overflow error to the user instead of looping.
- [ ] 6.5 Ensure the reactive path runs independently of the proactive flags.

## 7. Unit tests

- [ ] 7.1 Tier 1: budget-not-exceeded leaves results intact; over-budget truncates oldest-first with the exact literal string; unset flag disables.
- [ ] 7.2 Utilization: correct ratio from estimate and context window; zero/missing window yields no trigger.
- [ ] 7.3 Tier 2: triggers at exactly `0.75`; keeps 10 most recent verbatim; prefers cheap model; falls back to session model; no-op below threshold.
- [ ] 7.4 Tier 3: triggers at `0.97`; writes backup before mutation; summary-plus-last-user-message on success; keep-last-4 on summarization failure; no-op below threshold.
- [ ] 7.5 Reactive 413: compact-and-retry on 413; reserve floor honored; retry cap stops the loop and surfaces the error.

## 8. Integration test

- [ ] 8.1 End-to-end request-prep test exercising rising utilization across a session: Tier 1, then Tier 2 at 0.75, then Tier 3 at 0.97, asserting the outbound history at each stage and that a backup file is written on collapse.

## 9. Docs

- [ ] 9.1 Document the three `experimental` flags, the thresholds, the reactive 413 behavior, and the collapse backup location in the `packages/opencode` config reference, noting all are opt-in and default-off.
