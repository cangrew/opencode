## Why

opencode users on OpenAI ChatGPT/Codex subscriptions (Plus, Pro, Business) are billed against rolling usage windows: a primary window of roughly 5 hours and a secondary window of roughly one week. opencode gives them no visibility into how much of those limits they have consumed, so the first signal of trouble is a request that fails with "usage limit reached." At the same time, the token usage opencode already records is hard to read at a glance, and the cost figure in the sidebar is always $0 because cost is never actually computed. Users need an at a glance view of how close they are to their subscription limits and how many tokens and how much money the current session is spending.

## What Changes

- Capture OpenAI ChatGPT/Codex subscription usage from response metadata on successful responses and usage-limit errors (primary 5h and secondary weekly windows: used percent, window length, reset time) and persist the latest snapshot per account.
- Introduce a provider agnostic subscription usage data model and read path, so Anthropic Claude Pro/Max and GitHub Copilot can be added later without a refactor (only the OpenAI capture path is implemented now).
- Compute real token cost from models.dev pricing at message and session level, replacing the hardcoded `cost: 0` and keeping V2 session aggregates consistent.
- Add a new dedicated "Usage" panel to the TUI sidebar showing live session token usage (input, output, reasoning, cache breakdown), running cost, context window fill, and the OpenAI subscription limit meters with reset countdowns. The existing "Context" widget is left unchanged.
- Surface subscription usage over the HTTP/SDK API, TUI sync state, and a global real time event so the sidebar updates live and hydrates after restart.

Non goals: enforcing or blocking requests when a limit is reached (this change is display only), capturing Anthropic or Copilot usage, and any web app UI (the existing web usage indicator is untouched).

## Capabilities

### New Capabilities
- `subscription-usage-tracking`: capture, persist, and expose per account subscription usage windows. OpenAI ChatGPT/Codex is implemented now; the schema and read path are provider agnostic for future providers.
- `usage-cost-calculation`: compute per message and per session token cost from model pricing, replacing the hardcoded zero.
- `usage-sidebar-panel`: a dedicated TUI sidebar panel that renders live token usage, cost, context fill, and the subscription limit meters.

### Modified Capabilities
(none. `openspec/specs/` is empty, so no existing spec requirements change.)

## Impact

- **Core (`packages/core`)**: new subscription usage store and schema alongside `account.ts` and `credential.ts`; cost computation wired where `Step.Ended` is built (currently emits `cost: 0`) using the `model.ts` `Cost` schema and `models-dev.ts` pricing; V2 session aggregate handling for cost/tokens; new EventV2 event.
- **LLM (`packages/llm`)**: add an explicit response-metadata seam so successful response headers are available to protocol parsing; parse OpenAI `x-codex-*` subscription headers, 429 usage-limit headers, and streamed `rate_limits` snapshots.
- **Server and SDK**: new read/list endpoint plus global event for subscription usage; regenerate `packages/sdk/js`.
- **TUI (`packages/tui`)**: new `feature-plugins/sidebar/usage.tsx` registered in `feature-plugins/builtins.ts`, consuming session usage and subscription usage hydrated through sync state.
- **Dependencies**: none added. Pricing is already fetched from `models.dev`.
