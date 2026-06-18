# Tasks: Prompt Cache Stability

## 1. Config flag

- [ ] 1.1 Add `prompt_split_caching` to the experimental config schema in `packages/core/src/config/experimental.ts`, default disabled.
- [ ] 1.2 Plumb the resolved flag value into the system-prompt assembly path.
- [ ] 1.3 Document the flag and its default-off behavior in config types/comments.

## 2. Prompt-assembly refactor

- [ ] 2.1 Introduce a stable-prefix builder that emits, in fixed order: core identity, capabilities, tool guidelines, skills, AGENTS.md.
- [ ] 2.2 Introduce a dynamic-suffix builder that emits, in fixed order: environment info (cwd, date), session memory, active goal, persistent memory.
- [ ] 2.3 When the flag is enabled, assemble the system message as prefix + suffix; when disabled, fall back to the existing single-block assembly (byte-identical).

## 3. Move dynamic content to the suffix

- [ ] 3.1 Remove environment info (cwd, date) from any prefix path; emit only from the suffix builder.
- [ ] 3.2 Ensure session memory and persistent memory (agent-memory) are emitted only from the suffix.
- [ ] 3.3 Ensure the active goal (goal-system) is emitted only from the suffix.
- [ ] 3.4 Audit for any remaining time-varying or session-varying values in the prefix and relocate them.

## 4. Per-provider cache-control wiring

- [ ] 4.1 Attach a `CacheHint` to the stable prefix part in the core-to-LLM conversion (`packages/core/src/session/runner/to-llm-message.ts`).
- [ ] 4.2 Anthropic / Bedrock: apply sub-part `cache_control` on the prefix block within the existing system cache slot without consuming an extra breakpoint (`packages/llm/src/protocols/anthropic-messages.ts`).
- [ ] 4.3 Alibaba (Qwen): apply the same `cache_control` shape as Anthropic.
- [ ] 4.4 OpenAI / OpenAI-compatible: ensure the stable prefix is the leading content; no explicit marker.
- [ ] 4.5 OpenRouter: confirm pass-through inheritance from the upstream provider; no extra handling.
- [ ] 4.6 Local (Ollama): confirm no-op; no marker added.

## 5. One-hour TTL default

- [ ] 5.1 When split caching is enabled, set the stable-prefix cache marker to the 1-hour bucket (`EPHEMERAL_1H` via `Cache.ttlBucket`); leave the existing default TTL unchanged when the flag is disabled.
- [ ] 5.2 Verify TTL selection flows through provider lowering for all TTL-capable providers.

## 6. Prefix-stability assertion

- [ ] 6.1 Add a runtime assertion (dev/test) that the stable prefix is byte-stable across simulated consecutive turns.
- [ ] 6.2 Guard the prefix builder against known dynamic inputs (date, cwd, memory, goal).

## 7. Tests

- [ ] 7.1 Unit test: partition correctness, stable content in prefix and dynamic content in suffix.
- [ ] 7.2 Unit test: prefix byte-stability across turns when date/cwd/goal/memory change.
- [ ] 7.3 Unit test: provider wiring for Anthropic/Bedrock/Alibaba applies `cache_control` without reducing breakpoint count.
- [ ] 7.4 Unit test: OpenAI path adds no marker and keeps the prefix leading; local path is a no-op.
- [ ] 7.5 Unit test: TTL default resolves to the 1-hour bucket for the prefix.
- [ ] 7.6 Unit test: flag-disabled path is byte-identical to the legacy prompt.
- [ ] 7.7 Integration test: a second turn produces a cache hit (cached input tokens reported) against a cache-capable provider.

## 8. Docs

- [ ] 8.1 Document `experimental.prompt_split_caching`, the prefix/suffix model, per-provider behavior, and the 1-hour TTL default.
- [ ] 8.2 Note that the 1-hour TTL applies only to the split-caching prefix (no global TTL change) and the invariant that the prefix must stay byte-stable.
