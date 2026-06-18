# Prompt Cache Stability

## ADDED Requirements

### Requirement: Prefix and suffix partitioning

The system prompt SHALL be partitioned into a stable prefix and a dynamic suffix when `experimental.prompt_split_caching` is enabled. The stable prefix MUST contain core identity, capabilities, tool guidelines, skills, and AGENTS.md content. The dynamic suffix MUST contain environment info (cwd, date), session memory, active goal, and persistent memory.

#### Scenario: Stable content is placed in the prefix

- **WHEN** the system prompt is assembled with the flag enabled
- **THEN** core identity, capabilities, tool guidelines, skills, and AGENTS.md are emitted in the stable prefix block

#### Scenario: Dynamic content is placed in the suffix

- **WHEN** the system prompt is assembled with the flag enabled
- **THEN** environment info, session memory, active goal, and persistent memory are emitted in the dynamic suffix block and not in the prefix

### Requirement: Stable prefix MUST be byte-stable across turns

The stable prefix MUST be byte-for-byte identical across consecutive turns within a session whenever its underlying inputs (identity, capabilities, tools, skills, AGENTS.md) are unchanged. No per-turn or time-varying value (timestamps, counters, cwd, memory) may appear in the prefix.

#### Scenario: Prefix is identical across turns

- **WHEN** two consecutive turns are built in the same session with unchanged identity, tools, skills, and AGENTS.md
- **THEN** the produced stable prefix string is byte-for-byte identical between the two turns

#### Scenario: Time-varying value does not leak into the prefix

- **WHEN** the wall-clock date or cwd changes between turns
- **THEN** the stable prefix is unaffected and remains byte-for-byte identical

### Requirement: Dynamic content MUST live in the suffix

Content that changes during a session (session memory, active goal, environment info, persistent memory) MUST be emitted only in the dynamic suffix so that updating it does not invalidate the cached prefix.

#### Scenario: Updating goal or memory leaves the prefix intact

- **WHEN** the active goal, session memory, or persistent memory changes between turns
- **THEN** only the dynamic suffix changes and the stable prefix remains byte-for-byte identical

#### Scenario: Environment info changes only the suffix

- **WHEN** the date or cwd changes between turns
- **THEN** the change appears only in the dynamic suffix

### Requirement: Per-provider cache-control application

The stable prefix SHALL be marked for caching using each provider's native mechanism. For Anthropic, Bedrock, and Alibaba, a sub-part `cache_control` MUST be applied to the stable prefix within the existing system cache slot without consuming an additional cache breakpoint. For OpenAI and OpenAI-compatible providers, no explicit marker is applied; the longer byte-stable prefix increases automatic prefix-cache coverage. For local providers (Ollama), the marking MUST be a no-op.

#### Scenario: Anthropic applies sub-part cache_control without extra breakpoint

- **WHEN** the prefix is lowered for an Anthropic, Bedrock, or Alibaba request
- **THEN** `cache_control` is set on the stable prefix text block within the existing system cache slot and the available breakpoint count is not reduced

#### Scenario: OpenAI relies on automatic prefix caching

- **WHEN** the prefix is lowered for an OpenAI or OpenAI-compatible request
- **THEN** no explicit cache marker is added and the stable prefix is emitted as the leading content so more tokens match the automatic prefix cache

#### Scenario: Local provider is a no-op

- **WHEN** the prefix is lowered for a local provider such as Ollama
- **THEN** no cache marker is applied and the request is unchanged from the unsplit form

### Requirement: One-hour cache TTL for the stable prefix

When `experimental.prompt_split_caching` is enabled, the stable prefix SHALL be cached with a one-hour TTL so that idle sessions retain it. Providers that support a TTL selection MUST request the 1-hour bucket for the stable-prefix cache marker. This 1-hour TTL applies only to the split-caching stable prefix; when the flag is disabled, the existing default TTL is used unchanged for every request.

#### Scenario: Prefix is cached with a 1-hour TTL

- **WHEN** the stable prefix cache hint is lowered for a provider that supports TTL selection
- **THEN** the 1-hour TTL bucket is requested for the prefix cache marker

#### Scenario: Idle session retains the cache

- **WHEN** a session is idle for longer than five minutes but less than one hour and a new turn is sent
- **THEN** the stable prefix is still eligible for a cache hit because it was written with a 1-hour TTL

### Requirement: No-op when flag disabled

When `experimental.prompt_split_caching` is disabled, the system prompt MUST build byte-for-byte identically to the pre-change behavior with no prefix/suffix split and no added cache markers.

#### Scenario: Disabled flag produces the legacy prompt

- **WHEN** the system prompt is assembled with `experimental.prompt_split_caching` disabled
- **THEN** the prompt is byte-for-byte identical to the current single-block assembly and no split-specific cache markers are added

#### Scenario: Flag defaults to disabled

- **WHEN** no value is provided for `experimental.prompt_split_caching`
- **THEN** the feature is treated as disabled and the legacy prompt is produced
