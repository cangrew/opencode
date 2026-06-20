# Hybrid Model Routing + Tool-Output Compression

## Why

Lightweight, well-bounded tasks (session title generation, compaction/summarization, webfetch/websearch result processing, "complete" calls) do not need the main model and can route to a cheaper model for large cost savings at near-parity quality (static task-type routing is the safe, well-supported form: RouteLLM reports roughly 85% cost reduction at about 95% quality). Compression of large tool outputs is more conditional: an independent benchmark shows lossy compression can cost 3-55% accuracy and raise hallucination on precise or multi-hop reasoning, so compression must gate strictly to large low-density outputs, prefer EXTRACT/FILTER over SUMMARIZE for code, and never run on the precise-reasoning path.

## What Changes

- Add an opt-in `hybrid` config block (default off) with `cheap_model`, a compression line-count threshold, compression timeout/token/tail settings, and routing logging.
- Add a cheap-model resolver and a pure `resolveModel(taskType)` selector that routes lightweight task types to the configured `cheap_model` when hybrid is enabled and a `cheap_model` resolves, else falls back silently to the main model.
- Route compaction/summarization (the only lightweight LLM call site that exists in the current V2 port) through `resolveModel`. The selector already enumerates `title`, `complete`, `webfetch`, and `websearch` so those wire in as one-liners once their call sites exist (see Deferred scope).
- Add a self-contained tool-output compression engine that compresses large tool outputs (grep/glob/bash/read above a line-count threshold) via the cheap model using auto-selected EXTRACT / SUMMARIZE / FILTER templates, preserves the last N lines verbatim as an anti-hallucination anchor, bounds the call by timeout/max-tokens, and silently falls back to raw output on any error, timeout, or empty/invalid result.
- This is opt-in and default-off. No **BREAKING** changes: when `hybrid.enabled` is false or `cheap_model` is missing, behavior is identical to today.

### Deferred scope (not delivered by this change yet)

The following are out of scope until their dependencies land, because the call sites or pipeline they target do not exist in the current V2 port (see `design.md` "Call-site audit"):

- Routing for title generation, "complete" calls, and webfetch/websearch result processing: none of these perform an LLM call in current V2.
- The live tool-runtime compression hook: the tool-output pipeline ordering is owned by the unmerged `context-safety-net` change. The compression engine is built call-ready; only the thin wiring step is deferred.

## Capabilities

### New Capabilities

- `hybrid-routing`: routes a fixed set of lightweight task types to a configured cheap model, gated by an explicit enable flag and a resolvable cheap-model reference.
- `tool-output-compression`: pre-compresses large, low-density tool outputs using the cheap model with template selection, tail-line preservation, and silent fallback.

### Modified Capabilities

None — opt-in feature, default off.

## Impact

- **Packages**: `packages/core` (config schema, the `hybrid` resolver/selector module, session compaction routing, the compression engine and its tests), plus docs. The cheap-model resolver reuses the existing catalog/credential lookup in `SessionRunnerModel`, so no `packages/llm` change is required for this slice. The live tool-runtime compression hook is deferred.
- **Config**: new `hybrid` block: `hybrid.enabled` (default `false`), `hybrid.cheap_model` (`{ providerID, modelID }`), `hybrid.compression_threshold_lines` (default `40`), `hybrid.compression_timeout_ms` (default `5000`), `hybrid.compression_max_tokens` (default `1024`), `hybrid.compression_tail_lines` (default `3`), `hybrid.log_routing` (default `false`).
- **Providers**: the configured `cheap_model` provider must be installed/authenticated like any other provider; no new provider integrations are required.
- **Runtime**: an extra cheap-model call per routed task and per compressed tool output, bounded by `compression_timeout_ms` with silent fallback so the main path is never blocked or corrupted.
