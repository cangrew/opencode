# Hybrid Model Routing + Tool-Output Compression

## Why

Lightweight, well-bounded tasks (session title generation, compaction/summarization, webfetch/websearch result processing, "complete" calls) do not need the main model and can route to a cheaper model for large cost savings at near-parity quality (static task-type routing is the safe, well-supported form: RouteLLM reports roughly 85% cost reduction at about 95% quality). Compression of large tool outputs is more conditional: an independent benchmark shows lossy compression can cost 3-55% accuracy and raise hallucination on precise or multi-hop reasoning, so compression must gate strictly to large low-density outputs, prefer EXTRACT/FILTER over SUMMARIZE for code, and never run on the precise-reasoning path.

## What Changes

- Add an opt-in `hybrid` config block (default off) with `cheap_model`, compression timeout/token/tail settings, and routing logging.
- Route lightweight task types (title generation, compaction/summarization, "complete" calls, webfetch/websearch result processing) to the configured `cheap_model` when hybrid is enabled and a `cheap_model` is set.
- Add a tool-output compression pass that pre-compresses large tool outputs (grep/glob/bash/read above a line-count threshold) via the cheap model using auto-selected EXTRACT / SUMMARIZE / FILTER templates before the output reaches the main model.
- Always preserve the last N lines of the original output verbatim as an anti-hallucination anchor.
- Silently fall back to the raw, uncompressed output on any compression error or timeout, so results are never corrupted.
- This is opt-in and default-off. No **BREAKING** changes: when `hybrid.enabled` is false or `cheap_model` is missing, behavior is identical to today.

## Capabilities

### New Capabilities

- `hybrid-routing`: routes a fixed set of lightweight task types to a configured cheap model, gated by an explicit enable flag and a resolvable cheap-model reference.
- `tool-output-compression`: pre-compresses large, low-density tool outputs using the cheap model with template selection, tail-line preservation, and silent fallback.

### Modified Capabilities

None — opt-in feature, default off.

## Impact

- **Packages**: `packages/core` (config schema, session compaction/title routing, tool runtime compression hook, webfetch/websearch result handling), `packages/llm` (cheap-model resolution and request routing on the LLM call path), `packages/opencode` (config reference/docs surfacing).
- **Config**: new `hybrid` block: `hybrid.enabled` (default `false`), `hybrid.cheap_model` (`{ providerID, modelID }`), `hybrid.compression_timeout_ms` (default `5000`), `hybrid.compression_max_tokens` (default `1024`), `hybrid.compression_tail_lines` (default `3`), `hybrid.log_routing` (default `false`).
- **Providers**: the configured `cheap_model` provider must be installed/authenticated like any other provider; no new provider integrations are required.
- **Runtime**: an extra cheap-model call per routed task and per compressed tool output, bounded by `compression_timeout_ms` with silent fallback so the main path is never blocked or corrupted.
