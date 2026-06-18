# Prompt Cache Stability

## Why

The system prompt is currently assembled as a single monolithic block that mixes stable content (identity, tools, skills, AGENTS.md) with content that changes every turn (environment cwd/date, session memory, active goal, persistent memory). Because provider prompt caches are prefix-based, any change near the front of the prompt (even a timestamp) invalidates the cache from that point onward. This means we pay full input-token cost and full prefill latency on nearly every turn.

Splitting the system prompt into a byte-stable STABLE PREFIX (cached) and a per-turn DYNAMIC SUFFIX (not cached, or cached separately) lets providers reuse the prefix across turns. This is lossless by construction: the model sees the exact same total prompt, only the internal ordering and cache-control markers change. It is also the highest-confidence performance win available: vendors document roughly 50-90% input-cost reduction and up to roughly 85% latency reduction on cache hits, and the only requirement is keeping the prefix byte-stable. Pairing the split prefix with a 1-hour cache TTL (instead of the default 5 minutes for that prefix) keeps it warm across idle stretches, addressing the common case where a user thinks for several minutes between turns and would otherwise lose the cache. This longer TTL is part of the opt-in split and applies only to the stable prefix, not globally.

## What Changes

- Add an experimental config flag `experimental.prompt_split_caching`. When disabled (default), the prompt builds byte-for-byte identically to current behavior (full no-op).
- Refactor system-prompt assembly into two builders: a stable-prefix builder (core identity, capabilities, tool guidelines, skills, AGENTS.md) and a dynamic-suffix builder (environment info, session memory, active goal, persistent memory).
- Move environment info (cwd, date), session memory, active goal, and persistent memory out of the prefix and into the dynamic suffix so they never invalidate the cached prefix.
- Attach a cache hint to the stable prefix so each provider applies its native prompt-cache mechanism:
  - Anthropic / Bedrock: apply sub-part `cache_control` on the stable prefix text block within the existing system cache slot. This reuses the slot and does NOT consume an additional cache breakpoint.
  - Alibaba (Qwen): same `cache_control` format as Anthropic.
  - OpenAI / OpenAI-compatible: no explicit markers; a longer byte-stable prefix means more tokens match the automatic prefix cache (which engages at >= 1024 tokens).
  - OpenRouter: inherits the upstream provider's behavior, no extra handling.
  - Local (Ollama): no caching mechanism, no-op.
- Use a 1-hour cache TTL for the stable prefix, applied only when `experimental.prompt_split_caching` is enabled, so idle sessions keep the cached prefix. This does not change the cache TTL for any request when the flag is disabled.

**BREAKING**: None. When `experimental.prompt_split_caching` is disabled, the prompt and its cache markers are byte-for-byte unchanged, including the existing 5-minute TTL. The 1-hour TTL applies only to the split-caching stable prefix and only when the flag is enabled, so default behavior is unaffected.

## Capabilities

### New Capabilities

- `prompt-cache-stability`: Partition the system prompt into a byte-stable cached prefix and a per-turn dynamic suffix, apply per-provider cache-control so the prefix is reused across turns, and default to a 1-hour cache TTL. Gated behind `experimental.prompt_split_caching`.

### Modified Capabilities

None — no-op when flag disabled.

## Impact

- `packages/core`: system-prompt assembly refactored into prefix/suffix builders; environment, session memory, goal, and persistent memory relocated into the suffix; cache hint attached to the prefix; new experimental flag plumbed through.
- `packages/llm`: per-provider cache-control wiring confirmed/extended for Anthropic, Bedrock, Alibaba, OpenAI/compatible, OpenRouter, and local; the stable-prefix cache marker uses the 1h TTL bucket only when split caching is enabled.
- Interacts with `goal-system` and `agent-memory`: their dynamic content MUST remain in the suffix.
- No public API or schema breakage; default-off behind the experimental flag. The 1h TTL applies only to the split-caching prefix, so sessions with the flag disabled are byte-for-byte unchanged.
