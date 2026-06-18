# Design: Hybrid Model Routing + Tool-Output Compression

## Context

opencode currently runs every model call (primary turns, session title generation, compaction/summarization, "complete" calls, webfetch/websearch result processing, and tool-output handling) against a single configured main model. Lightweight, well-bounded tasks do not need the main model's capability, and large low-density tool outputs (grep/glob/bash/read dumps) consume context disproportionate to their value. This change ports the opencode-x "hybrid" feature (canonical commits 3f6df7df0, d0d545bf0, 6be34d9fd) into this monorepo: a fixed task-type router to a cheap model, plus an optional tool-output compression pass. The relevant integration surfaces are `packages/core/src/session/compaction.ts` (summarization), session title generation, the tool runtime / tool registry in `packages/core/src/tool/`, the webfetch/websearch tools, and the LLM call path in `packages/llm` (`LLM.request` / `dependencies.llm.stream`). Config lives in `packages/core/src/config` using Effect `Schema.Class` definitions.

## Goals / Non-Goals

**Goals:**

- Add an opt-in, default-off `hybrid` config block with a resolvable `cheap_model` reference.
- Route the enumerated lightweight task types to the cheap model when hybrid is active.
- Compress large, low-density tool outputs via the cheap model with auto-selected EXTRACT/SUMMARIZE/FILTER templates, gated by a line-count threshold.
- Always preserve the last N lines verbatim and silently fall back to raw output on any failure.
- Match existing conventions: immutable data, small focused files, explicit error handling, Bun APIs, snake_case config keys.

**Non-Goals:**

- Dynamic per-request confidence routing or learned router models.
- Compressing primary-turn content or any content on the precise-reasoning path.
- Adding new provider integrations (the cheap model uses existing provider plumbing).
- Changing default behavior for existing users (feature is default off).

## Decisions

- **Cheap-model config shape**: `hybrid.cheap_model` is `{ providerID: string, modelID: string }`, mirroring the existing model-reference shape so it resolves through the same provider/model lookup used by the main model. The full block: `hybrid.{ enabled: boolean = false, cheap_model?: { providerID, modelID }, compression_timeout_ms: number = 5000, compression_max_tokens: number = 1024, compression_tail_lines: number = 3, log_routing: boolean = false }`. Keys are snake_case to match config conventions.
- **Where routing hooks in**: routing is a single resolution helper at the LLM call path. Each lightweight call site (title, `compaction.ts` summarization, "complete", webfetch/websearch processing) asks a `resolveModel(taskType)` helper which returns the cheap model when hybrid is active and the task type is lightweight, else the main model. Primary turns never call this helper, so they always stay on the main model. This keeps the change localized and avoids threading a model parameter through unrelated code.
- **Template selection logic**: selection is a pure function of source tool type. grep/glob/bash → EXTRACT (key lines plus file/line refs), read/prose → SUMMARIZE (3-6 bullets), recognized logs/diffs → FILTER (matching items only). Code-oriented outputs prefer EXTRACT/FILTER over SUMMARIZE to avoid lossy paraphrase of precise content. Templates are small static prompt builders in a dedicated compression module under `packages/core/src/session` (or a sibling `tool` helper), keeping each template focused.
- **Threshold defaults**: compression only fires above a line-count threshold (large low-density outputs); outputs at or below pass through verbatim. `compression_tail_lines` defaults to 3, `compression_timeout_ms` to 5000, `compression_max_tokens` to 1024. The tail lines are appended verbatim after the compressed body.
- **Silent fallback**: the compression call is wrapped so any error, timeout, or empty/invalid result yields the original raw output. Failures are never surfaced to the user and never partially applied.
- **Tool-output pipeline ordering**: tool outputs are acted on by this capability's compression, by the `context-safety-net` Tier 1 character budget, and by the existing per-output truncation. These MUST compose in one defined order so they do not double-process or fight: compress large low-density outputs first, then apply the Tier 1 character budget over the resulting sizes, treating a compressed output as a single unit for the budget's character count. The exact interaction with the existing `serialize()` truncation is settled during implementation. Compression is also non-deterministic (a cheap-model rewrite), so the compressed form of a given tool output SHOULD be cached/reused for that output rather than recomputed, to avoid thrashing any cache keyed on tool output.
- **Alternatives considered**: dynamic-confidence routing (route per request based on a learned difficulty/confidence score) was rejected. It risks routing collapse (the router drifting most traffic to one model), is harder to reason about, and the evidence base for safe gains is around static task-type routing. We chose the static, auditable form.

## Risks / Trade-offs

- [Risk] Compression accuracy loss: lossy compression can cost 3-55% accuracy and increase hallucination on precise or multi-hop reasoning. → Mitigation: gate compression strictly to large low-density outputs via the line-count threshold, prefer EXTRACT/FILTER over SUMMARIZE for code, always preserve the last N lines verbatim as an anchor, and never compress content on the precise-reasoning path (primary turns are never compressed).
- [Risk] Cheap model produces malformed or empty output. → Mitigation: silent fallback to raw output on any error/timeout/empty result, so results are never corrupted.
- [Risk] Added latency from extra cheap-model calls. → Mitigation: compression is bounded by `compression_timeout_ms` and capped at `compression_max_tokens`; on timeout the raw output is used so the main path is never blocked.
- [Risk] Misconfigured or unavailable cheap model breaks routed tasks. → Mitigation: routing and compression silently disable when `cheap_model` does not resolve; behavior falls back to the main model / raw output.
- [Risk] Cost-quality trade-off is workload-dependent. → Mitigation: feature is opt-in and default off, with `log_routing` to audit routing decisions before broad adoption.

## Open Questions

- What is the right default line-count threshold for compression, and should it differ per tool type (e.g. higher for bash than read)?
- Should compression be independently togglable from routing (a separate `hybrid.compression_enabled`) rather than sharing the single `enabled` gate?
- Should log/diff detection for FILTER be heuristic on content, declared by the tool, or both?
- Should webfetch/websearch result processing also pass through compression, or only routing?
