# Design: Prompt Cache Stability

## Context

Provider prompt caches are prefix-based: a request hits the cache only for the longest leading byte span that matches a previously cached request. Today the system prompt is one block that interleaves stable content (identity, tools, skills, AGENTS.md) with per-turn content (cwd, date, session memory, active goal, persistent memory). Because the per-turn content sits near or within the front of the prompt, the cacheable prefix is short or invalidated every turn, so we pay full prefill cost and latency repeatedly.

The LLM layer already models caching: `packages/llm/src/protocols/anthropic-messages.ts` carries a `CacheHint` per part, a `Cache.Breakpoints` budget (`ANTHROPIC_BREAKPOINT_CAP = 4`), and `Cache.ttlBucket` mapping to `EPHEMERAL_5M` / `EPHEMERAL_1H`. The core layer assembles the system prompt and converts it to LLM messages (`packages/core/src/session/runner/to-llm-message.ts`, `Message.system(...)`). This change reorders that assembly and attaches a hint to the stable prefix, then relies on the existing per-provider lowering.

## Goals / Non-Goals

Goals:
- Maximize prompt-cache hit rate by keeping a long byte-stable prefix.
- Keep the change lossless: identical total prompt content, only ordering and cache markers differ.
- Gate everything behind `experimental.prompt_split_caching`, default off, full no-op when disabled.
- Default the cache TTL to 1 hour so idle sessions stay warm.

Non-Goals:
- Changing prompt wording or which content is included.
- Adding new cache breakpoints or a second cache slot for the prefix.
- Implementing caching for providers that have no caching mechanism (local).
- Reworking goal-system or agent-memory content; they only need to remain in the suffix.

## Decisions

### Prompt-section ordering and the prefix/suffix boundary

The system prompt is assembled in two named builders. The stable-prefix builder emits, in fixed order: core identity, capabilities, tool guidelines, skills, AGENTS.md. The dynamic-suffix builder emits, in fixed order: environment info (cwd, date), session memory, active goal, persistent memory. The boundary is the single most important invariant: everything above it must be free of time-varying or session-varying values. The two strings are concatenated (prefix then suffix) into the system message so the model sees the same total content as before.

### Per-provider cache-control strategy

The stable prefix carries a `CacheHint`. Lowering stays per-provider:
- Anthropic / Bedrock: emit the prefix as its own text block with `cache_control` set, placed within the existing system cache slot. The suffix follows as additional text without a marker. This reuses the slot rather than adding a breakpoint.
- Alibaba (Qwen): identical `cache_control` shape to Anthropic.
- OpenAI / OpenAI-compatible: no explicit marker. The win is structural: a long byte-stable leading span matches the automatic prefix cache (engages at >= 1024 tokens). We simply ensure the stable prefix is the leading content.
- OpenRouter: pass through; it inherits the upstream provider's caching.
- Local (Ollama): no-op; no marker, request identical to unsplit form.

### Not consuming extra breakpoints

The prefix marker is applied within the system slot that is already counted against `Cache.Breakpoints`. We attach the hint to the prefix sub-part rather than introducing a new breakpoint, so `breakpoints.remaining` is not decremented beyond today's usage. This avoids starving message-level cache breakpoints later in the conversation.

### 1-hour TTL default rationale

Default TTL moves from the 5-minute bucket (`EPHEMERAL_5M`) to the 1-hour bucket (`EPHEMERAL_1H`). Agent sessions frequently idle for minutes between turns (user reading, thinking, editing). A 5-minute TTL loses the prefix in exactly those gaps, defeating the optimization. The 1-hour TTL keeps it warm across realistic idle stretches. The cost is a slightly higher cache-write price, which is small relative to the repeated full-prefill cost it avoids.

### Interaction with goal-system and agent-memory

Active goal (goal-system) and session/persistent memory (agent-memory) are inherently dynamic. They MUST be emitted only by the dynamic-suffix builder. If a future change adds these to the prefix path, the prefix-stability assertion (see Risks) will fail, surfacing the regression.

### Alternatives considered

- Single monolithic prompt (status quo): simplest, but yields short or invalidated cacheable prefixes and pays full prefill cost most turns. Rejected as the problem being solved.
- A second cache slot dedicated to the prefix: would consume an extra breakpoint and complicate budget accounting for little gain over a sub-part marker in the existing slot. Rejected.

## Risks / Trade-offs

- [Risk] Accidental prefix instability silently invalidates the cache (a future contributor adds a timestamp or cwd to a prefix section). → Mitigation: add a runtime assertion plus a unit test that builds the prefix twice across simulated turns and asserts byte-equality; lint/guard the prefix builder against known dynamic inputs.
- [Risk] 1-hour TTL increases cache-write cost on sessions that idle past one hour and never hit. → Mitigation: accepted trade-off; write cost is small versus repeated full prefill, and the common case (sub-hour idle) benefits.
- [Risk] A provider misreads the sub-part `cache_control` and consumes an extra breakpoint. → Mitigation: assert breakpoint count is unchanged in provider-wiring unit tests for Anthropic/Bedrock/Alibaba.
- [Trade-off] Reordering content (dynamic moved to the end) is a behavior-equivalent but non-identical prompt when the flag is ON. The flag-off path stays byte-identical to preserve a safe default.

## Open Questions

- Should the suffix also receive its own short-TTL cache hint, or remain uncached given it changes most turns?
- Is there a provider (beyond Alibaba) that shares Anthropic's `cache_control` shape and should be wired the same way?
- Should the 1-hour TTL default be globally applied or scoped to the stable prefix only when split caching is enabled?
