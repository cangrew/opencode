## Context

Current state, from the codebase:

- **Auth**: OpenAI ChatGPT subscription auth already exists as a provider plugin (`packages/core/src/plugin/provider/openai-auth.ts`). It runs the codex CLI OAuth flow and stores a `Credential.OAuth` (`packages/core/src/credential.ts`) with the ChatGPT account id in `metadata.accountID`. There is a richer account concept in `packages/core/src/account.ts` plus `account/sql.ts` used for opencode's own accounts, which is a good storage pattern to follow.
- **Token usage**: Per message token counts (input, output, reasoning, cache read and write) live on the assistant message (`packages/core/src/session/message.ts`). They are aggregated into session totals in `SessionTable` (`packages/core/src/session/sql.ts`) by `applyUsage()` in `packages/core/src/session/projector.ts`, which increments or decrements by a sign so add and remove stay consistent. Usage reaches the projector through `Step.Ended` events (`packages/core/src/session/event.ts`) published by `packages/core/src/session/runner/publish-llm-event.ts`.
- **Cost**: `publish-llm-event.ts` currently emits `cost: 0`. Pricing is modeled by the `Cost` schema in `packages/core/src/model.ts` (per token input, output, and cache prices, plus optional context size tiers) and fetched from models.dev by `packages/core/src/models-dev.ts`.
- **Rate limits**: `packages/llm/src/route/executor.ts` parses provider rate limit headers in `rateLimitDetails()` and builds `HttpRateLimitDetails` (`packages/llm/src/schema/errors.ts`), but only for `x-ratelimit-*` (OpenAI API) and `anthropic-ratelimit-*`, and only attaches them to error contexts. It does not read OpenAI subscription `x-codex-*` headers.
- **LLM event metadata**: Successful HTTP response headers are currently dropped by the HTTP transport before protocol stream parsing, while non-2xx responses still expose headers to `rateLimitDetails()`. `LLMEvent.step-finish` can carry `providerMetadata`, but the session publisher drops that metadata when creating `SessionEvent.Step.Ended`, and `Step.Ended` has no subscription usage field.
- **V2 session aggregation**: Current V2 `Step.Ended` projection updates the assistant message's cost and tokens, but does not call the legacy `applyUsage()` aggregate path. Computing a real message cost is not enough by itself to update `SessionTable.cost` or session token totals.
- **TUI sidebar**: The session sidebar (`packages/tui/src/routes/session/sidebar.tsx`) renders feature plugins registered in `packages/tui/src/feature-plugins/builtins.ts` into named slots. The existing Context widget (`packages/tui/src/feature-plugins/sidebar/context.tsx`) shows last message tokens, percent of context used, and `session.cost`. TUI sync state does not currently expose subscription usage, and the TUI listens to the global event stream rather than the instance-only `/event` stream.

OpenAI subscription usage shape (confirmed against OpenAI's own codex v2 protocol): two rolling windows, `primary` (about 5 hours) and `secondary` (about one week). Each window is `{ usedPercent, windowMinutes, resetsAt }`. The backend returns them as response headers `x-codex-primary-used-percent`, `x-codex-primary-window-minutes`, `x-codex-primary-reset-after-seconds` (and the `secondary` equivalents), and also as a `rate_limits` object in streamed terminal response events.

## Goals / Non-Goals

**Goals:**
- Capture OpenAI subscription usage windows during successful requests and usage-limit errors, then persist the latest snapshot per account.
- Keep the data model and read path provider agnostic so Anthropic and Copilot can be added later.
- Compute real per message and per session cost from models.dev pricing.
- Add a dedicated TUI sidebar Usage panel showing token breakdown, cost, context fill, and subscription limit meters that update live.

**Non-Goals:**
- Enforcing or throttling requests at the limit. This is display only.
- Capturing Anthropic Claude Pro/Max or GitHub Copilot usage now (the schema is ready for them; the capture path is not built).
- Any web app or desktop UI changes.
- Historical usage charts, or persistence beyond the latest snapshot per account.

## Decisions

### 1. Capture usage before response metadata is lost

The `x-codex-*` headers arrive on the model response inside `packages/llm`, but successful response headers are currently discarded before protocol parsing. Add an explicit response metadata seam at the transport/protocol boundary so normalized headers are available on successful streams. Keep non-2xx parsing in the executor for 429 and other error responses, because usage-limit errors often carry the same headers.

Parse all supported sources into one normalized snapshot shape: successful `x-codex-*` headers, non-2xx `x-codex-*` headers, and streamed `rate_limits` snapshots from OpenAI Responses/Codex terminal events. Attach the normalized snapshot to a typed LLM event field or provider metadata before the session publisher drops protocol metadata. Core must either persist the snapshot before `SessionEvent.Step.Ended` is built or extend the session event schema to carry it.

Alternative considered: a separate out of band request to a usage endpoint. Rejected because the data is already on every response, so a side request adds latency, another failure mode, and another auth path.

### 2. Store the latest snapshot per account in core, not on the session

Add a small subscription usage store in `packages/core` (a table keyed by `provider` plus `accountID`, following the `account/sql.ts` pattern) holding the latest snapshot and a captured-at timestamp. Subscription limits are an account property, not a session property: the same 5h window is shared across every session for that account, so storing it on the session would duplicate and desync it.

Alternative considered: in memory only. Rejected because the sidebar should show meaningful values immediately on startup, before the first request of a new run.

### 3. Provider agnostic schema

Model the record as `{ provider, accountID, primary?, secondary?, capturedAt }` where each window is `{ usedPercent, windowMinutes, resetsAt }`, mirroring OpenAI's `RateLimitWindow`. OpenAI maps `reset-after-seconds` to an absolute `resetsAt = now + seconds`. A future provider only needs its own parser that produces the same shape. A newer snapshot replaces an older snapshot by capture time, even when `usedPercent` decreases after a rolling window reset.

### 4. Cost calculation co-located with usage aggregation

Compute cost where tokens and model catalog data are both available. `publish-llm-event.ts` currently receives only a `ModelV2.Ref`, so the implementation must either pass the resolved model cost into the publisher or compute the cost at a nearby call site before building `SessionEvent.Step.Ended`.

OpenCode model prices are USD per 1,000,000 tokens. The cost helper must divide by `1_000_000`, charge visible output and reasoning tokens at the output price unless a future model schema adds separate reasoning pricing, and charge cache read/write tokens at their cache prices. Tier selection uses the current request context size, not cumulative session token totals. Unknown pricing yields cost 0.

V2 session totals also need explicit aggregation. Updating the assistant message cost on `Step.Ended` is not enough to update `SessionTable.cost`; the projector or equivalent aggregate path must add/remove cost consistently with V2 message add/remove/regenerate behavior.

Alternative considered: compute cost lazily in the UI. Rejected because cost then cannot be stored, exported, or aggregated server side, and every client would reimplement pricing.

### 5. New dedicated Usage panel, existing Context widget untouched

Add `packages/tui/src/feature-plugins/sidebar/usage.tsx`, registered in `builtins.ts`, following the Context plugin pattern (`createMemo` over `props.api.state.session`). It reads session totals for cumulative token breakdown and cost, but calculates context fill from the current context pressure, such as the latest assistant turn's prompt/output tokens against the model context limit, not from cumulative session totals. The subscription section reads the new subscription usage sync state and renders only when a snapshot exists for the active account.

Alternative considered: extend the Context widget. Rejected per the product decision to keep Context stable and give usage its own space for the breakdown and meters.

### 6. Expose subscription usage via the existing server, SDK, and event patterns

Add read/list endpoints plus a usage update event alongside the existing provider and session groups, and regenerate `packages/sdk/js`. The TUI needs initial hydration through its sync bootstrap plus live updates from the global EventV2 stream, not only the instance `/event` stream. The new event must be registered early enough to appear in the global event schema and emitted through the existing EventV2 bridge/GlobalBus path.

## Risks / Trade-offs

- [The `x-codex-*` header names or `rate_limits` shape may differ from the confirmed codex v2 protocol, or change over time] → Centralize parsing in one helper with optional fields; missing or unparseable fields degrade to "unknown" rather than erroring, and the stored snapshot is simply left unchanged.
- [opencode may not yet route subscription requests through the codex backend that returns these headers] → The parser is a no op when headers are absent, so this ships safely. Wiring the subscription request path, if missing, is verified during implementation and tracked as a task. The cost and token tracker work regardless.
- [models.dev pricing may be missing or stale for some models] → Unknown pricing yields cost 0 (per spec) rather than a wrong number; the displayed cost is an estimate.
- [Current response plumbing drops successful headers] → Add the response metadata seam before implementing the parser, and test both success and error paths.
- [Reset countdown drift] → Store an absolute `resetsAt` and let the UI compute the countdown at render time from the current clock.
- [Cost double counting on edit or regenerate] → Reuse the existing sign based `applyUsage()` add and remove path so cost stays consistent with tokens.

## Migration Plan

- Additive only. New table via a Drizzle migration (follow `packages/core/src/database/migration/`), new schema, new endpoint and event, new TUI plugin.
- No change to existing message or session token columns. The only change to existing behavior is that `cost` becomes non zero, which existing readers already treat as a number.
- Rollback: remove the new plugin registration and endpoint; the migration adds an isolated table that can be dropped. Reverting the cost helper restores `cost: 0` with no schema impact.

## Open Questions

- Does opencode already send subscription (ChatGPT/Codex) model requests to the backend that returns `x-codex-*` headers, or does that request path still need wiring? Confirm early during implementation and include the `ChatGPT-Account-Id` account header when needed.
- Should the panel switch to a warning style when a window is near 100 percent used (for example change color above a threshold)?
