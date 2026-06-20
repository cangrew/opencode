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

## Call-site audit (current V2 port, 2026-06-19)

The original design assumed the opencode-x lightweight call sites already existed here. An audit of the V2 codebase shows otherwise, which is why this change scopes routing to compaction only and defers the rest:

- **compaction/summarization** — EXISTS. `session/compaction.ts` streams a summary via `dependencies.llm.stream` using `input.model`. This is the one live lightweight LLM call site, so it is the only one routed now.
- **title generation** — ABSENT. No LLM call generates titles; `session/runner/llm.ts:77` lists "Update title, summaries... in bounded background work" as an unchecked TODO.
- **"complete" calls** — ABSENT. No "complete" tool or call site exists.
- **webfetch result processing** — ABSENT. `tool/webfetch.ts` returns raw markdown/text/html with no LLM post-processing pass.
- **websearch result processing** — ABSENT. `tool/websearch.ts` returns raw provider text; the code notes "V2 invocation context does not safely expose the model yet."
- **tool-output → model path** — the real compression seam is `ToolOutputStore.bound` (`tool-output-store.ts`), which already size-bounds every tool output before it reaches the model, reached via `toolMaterialization.settle` in `session/runner/llm.ts`. `BoundInput` does not currently carry the tool name (needed for template selection) and the storage service has no LLM dependency, so live wiring is a deferred step (also gated on `context-safety-net` owning the pipeline order).

`resolveModel` still enumerates `title`/`complete`/`webfetch`/`websearch` as lightweight task types, so wiring each is a one-liner once its call site lands.

## Decisions

- **Cheap-model config shape**: `hybrid.cheap_model` is `{ providerID: string, modelID: string }`, mirroring the existing model-reference shape so it resolves through the same catalog/credential lookup used by the main model. The full block: `hybrid.{ enabled: boolean = false, cheap_model?: { providerID, modelID }, compression_threshold_lines: number = 40, compression_timeout_ms: number = 5000, compression_max_tokens: number = 1024, compression_tail_lines: number = 3, log_routing: boolean = false }`. Keys are snake_case to match config conventions.
- **Where routing hooks in**: routing is a single pure selector, `resolveModel(taskType, { main, cheap, settings })`, returning the cheap model when hybrid is active and the task type is lightweight, else the main model. The cheap `Model` is resolved once (via the same catalog/credential path `SessionRunnerModel` uses) and passed in, keeping the selector pure and testable. Each lightweight call site asks the selector; primary turns never do, so they always stay on the main model. In this slice only `compaction.ts` calls it.
- **Template selection logic**: selection is a pure function of source tool name plus a light content heuristic. grep/glob/bash → EXTRACT (key lines plus file/line refs), read/prose → SUMMARIZE (3-6 bullets), recognized logs/diffs → FILTER (matching items only). Code-oriented outputs prefer EXTRACT/FILTER over SUMMARIZE to avoid lossy paraphrase of precise content. Templates are small static prompt builders in a dedicated module under `packages/core/src/hybrid`, keeping each template focused.
- **Threshold defaults**: compression only fires above `compression_threshold_lines` (default `40`); outputs at or below pass through verbatim. A single threshold (not per-tool) keeps gating auditable; per-tool tuning is a later refinement if logging shows it is needed. `compression_tail_lines` defaults to 3, `compression_timeout_ms` to 5000, `compression_max_tokens` to 1024. The tail lines are appended verbatim after the compressed body.
- **Single enable gate**: compression and routing share the one `hybrid.enabled` gate (plus a resolvable `cheap_model`) rather than a separate `compression_enabled`. KISS for the opt-in default-off feature; a split toggle can be added later without breaking config since both currently require `enabled`.
- **Log/diff detection for FILTER**: heuristic on content (e.g. unified-diff `@@`/`+++`/`---` markers, timestamped log lines) combined with the originating tool name. No new per-tool declaration is introduced for this slice.
- **Silent fallback (HM-feedback)**: the compression call is wrapped so any error, timeout, or empty/invalid result yields the original raw output. Failures are never surfaced to the user and never partially applied. "Empty/invalid" includes a result that is only whitespace or that drops the verbatim tail.
- **Compression determinism (resolves HM2)**: a cheap-model rewrite is non-deterministic, so compression is a pure function of `(rawOutput, toolName, settings)` and the live hook (deferred) MUST memoize the compressed form per tool-output identity (e.g. keyed on `toolCallID`) rather than recompute it. This keeps any cache keyed on tool output stable and avoids thrashing prompt-cache prefixes across turns. The engine in this slice is deterministic given a fixed cheap-model response, which the tests exploit via a stubbed model.
- **Tool-output pipeline ordering (resolves HM4)**: tool outputs are acted on by this capability's compression, by the `context-safety-net` Tier 1 character budget, and by the existing `ToolOutputStore.bound` truncation. Defined order: compress large low-density outputs first, then apply the Tier 1 character budget over the resulting sizes (a compressed output counts as a single unit), then `bound` truncation as the final safety net. Because `context-safety-net` (which owns Tier 1 and the canonical pipeline order) is unmerged, the live hook is deferred so this change does not encode a speculative order; this slice ships the engine and the documented contract only.
- **Alternatives considered**: dynamic-confidence routing (route per request based on a learned difficulty/confidence score) was rejected. It risks routing collapse (the router drifting most traffic to one model), is harder to reason about, and the evidence base for safe gains is around static task-type routing. We chose the static, auditable form.

## Risks / Trade-offs

- [Risk] Compression accuracy loss: lossy compression can cost 3-55% accuracy and increase hallucination on precise or multi-hop reasoning. → Mitigation: gate compression strictly to large low-density outputs via the line-count threshold, prefer EXTRACT/FILTER over SUMMARIZE for code, always preserve the last N lines verbatim as an anchor, and never compress content on the precise-reasoning path (primary turns are never compressed).
- [Risk] Cheap model produces malformed or empty output. → Mitigation: silent fallback to raw output on any error/timeout/empty result, so results are never corrupted.
- [Risk] Added latency from extra cheap-model calls. → Mitigation: compression is bounded by `compression_timeout_ms` and capped at `compression_max_tokens`; on timeout the raw output is used so the main path is never blocked.
- [Risk] Misconfigured or unavailable cheap model breaks routed tasks. → Mitigation: routing and compression silently disable when `cheap_model` does not resolve; behavior falls back to the main model / raw output.
- [Risk] Cost-quality trade-off is workload-dependent. → Mitigation: feature is opt-in and default off, with `log_routing` to audit routing decisions before broad adoption.

## Open Questions

- Resolved: default threshold is a single `compression_threshold_lines = 40` (not per-tool for now); revisit per-tool tuning if `log_routing` data warrants it.
- Resolved: compression and routing share the single `hybrid.enabled` gate for this slice; a split `compression_enabled` toggle can be added later without a breaking change.
- Resolved: FILTER's log/diff detection is a content heuristic combined with the originating tool name.
- Deferred with the live hook: whether webfetch/websearch results pass through compression in addition to routing, decided once those call sites and the `context-safety-net` pipeline order exist.
