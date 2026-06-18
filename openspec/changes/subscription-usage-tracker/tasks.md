## 1. Cost calculation

- [x] 1.1 Add a `computeCost(modelCost, tokens, contextSize)` helper in `packages/core` that treats model prices as USD per 1,000,000 tokens and selects the highest matching context tier
- [x] 1.2 Charge visible output and reasoning tokens at the model output price, cache read/write tokens at cache prices, and unknown pricing as 0
- [x] 1.3 Pass or resolve model catalog cost and current request context size at the `Step.Ended` build point, replacing `cost: 0` in `packages/core/src/session/runner/publish-llm-event.ts` or an equivalent nearby call site
- [x] 1.4 Add V2 session aggregate handling so `SessionTable.cost` and token totals update when `SessionEvent.Step.Ended` adds, removes, edits, or regenerates assistant messages
- [x] 1.5 Unit tests: known pricing divides by 1,000,000, reasoning uses output price, unknown pricing yields 0, tiered pricing uses current request context not cumulative session totals, and V2 session totals stay consistent across add/remove/regenerate

## 2. Subscription usage capture (packages/llm)

- [x] 2.1 Add a response metadata seam so successful HTTP response headers are available to protocol parsing instead of being dropped by `packages/llm/src/route/transport/http.ts`
- [x] 2.2 Add a shared `subscriptionUsage(headers, now)` parser that reads `x-codex-primary-*` and `x-codex-secondary-*` headers into `{ usedPercent, windowMinutes, resetsAt }` windows (convert reset seconds to an absolute time)
- [x] 2.3 Parse subscription usage headers on successful responses and on non-2xx/429 usage-limit errors
- [x] 2.4 Decode `rate_limits` snapshots from OpenAI streamed terminal events, including Codex terminal event naming if it differs from `response.completed`
- [x] 2.5 Attach the parsed snapshot to a typed LLM event field or provider metadata that core reads before metadata is dropped
- [x] 2.6 Confirm and, if needed, wire OpenAI ChatGPT/Codex subscription requests to the backend that returns `x-codex-*` headers, including the `ChatGPT-Account-Id` header
- [x] 2.7 Unit tests: full headers, partial windows (primary only), absent headers produce no snapshot, 429 usage-limit headers are captured, streamed `rate_limits` is captured, and successful response headers survive the transport/protocol seam

## 3. Subscription usage store and schema (packages/core)

- [x] 3.1 Define a provider agnostic `SubscriptionUsage` schema `{ provider, accountID, primary?, secondary?, capturedAt }` with the shared window shape
- [x] 3.2 Add a Drizzle migration and table keyed by `provider` plus `accountID` (follow the `account/sql.ts` pattern) storing the latest snapshot
- [x] 3.3 Add a store service with upsert latest, read by account, and list operations
- [x] 3.4 Resolve the active provider account before the LLM metadata is lost; support core `Credential.OAuth.metadata.accountID` and current OpenAI/Codex auth account id surfaces without merging distinct accounts
- [x] 3.5 On LLM events carrying a snapshot and a stable account id, upsert by provider/account, then emit a subscription usage update event only when the stored client-visible snapshot changes
- [x] 3.6 Leave the stored snapshot unchanged when usage metadata is absent or the account id cannot be resolved
- [x] 3.7 Unit tests: newer snapshot replaces older, newer lower-percent reset replaces older, stale older snapshot is ignored, per-account scoping is isolated, missing account id skips persistence, and unchanged snapshots do not emit duplicate update events

## 4. Server and SDK

- [ ] 4.1 Add read/list endpoints returning latest subscription usage by provider/account and all latest snapshots needed for startup hydration (empty result/list when none has been captured)
- [ ] 4.2 Add the subscription usage update as an EventV2 global event that reaches TUI clients through the existing EventV2 bridge/GlobalBus path
- [ ] 4.3 Regenerate `packages/sdk/js` and verify the generated types
- [ ] 4.4 Endpoint tests: returns a stored snapshot, lists stored snapshots, returns empty when none exists, and generated SDK types include the endpoint and event

## 5. TUI Usage panel (packages/tui)

- [ ] 5.1 Add subscription usage state to `packages/tui/src/context/sync.tsx`, hydrate it from the read/list endpoint on startup, and update it from the global subscription usage event
- [ ] 5.2 Expose subscription usage through the TUI plugin state API used by sidebar feature plugins
- [ ] 5.3 Add `packages/tui/src/feature-plugins/sidebar/usage.tsx` rendering cumulative token breakdown (input, output, reasoning, cache), total cost as currency, and current context fill percent from session/message state
- [ ] 5.4 Compute context fill from current context pressure, not cumulative session totals
- [ ] 5.5 Render the primary and secondary subscription meters with used percent and a reset countdown when a snapshot exists for the active OpenAI account
- [ ] 5.6 Register the plugin in `packages/tui/src/feature-plugins/builtins.ts` and leave the existing Context widget unchanged
- [ ] 5.7 Hide the subscription section when no snapshot exists, for example API key providers, and update meters downward after a rolling-window reset

## 6. Verification

- [ ] 6.1 `bun typecheck` and `bun lint` pass
- [ ] 6.2 Package tests pass: `cd packages/core && bun test` and `cd packages/opencode && bun test`
- [ ] 6.3 Manual: run `bun dev`, open the sidebar, confirm the token breakdown and cost render; with an OpenAI subscription account confirm the limit meters appear and update after a turn
- [ ] 6.4 `openspec validate subscription-usage-tracker` passes
