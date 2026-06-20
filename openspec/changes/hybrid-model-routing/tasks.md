# Tasks: Hybrid Model Routing + Tool-Output Compression

> Scope note (2026-06-19): the original task list assumed the opencode-x call
> sites (title generation, "complete" calls, webfetch/websearch result
> processing) and a settled tool-output pipeline already existed in this V2
> port. They do not yet. Title/complete/webfetch/websearch perform no LLM call
> in current V2, and the tool-output pipeline ordering is owned by the unmerged
> `context-safety-net` change. This revision implements everything that is
> self-contained and real today and explicitly defers the rest with reasons.
> See `design.md` ("Call-site audit") for details.

## 1. Config Schema

- [x] 1.1 Add the `hybrid` block to the config schema in `packages/core/src/config` using Effect `Schema.Class`, with snake_case keys.
- [x] 1.2 Add `hybrid.enabled` (boolean, default `false`) and `hybrid.cheap_model` (`{ providerID, modelID }`, optional).
- [x] 1.3 Add `hybrid.compression_threshold_lines` (default `40`), `hybrid.compression_timeout_ms` (default `5000`), `hybrid.compression_max_tokens` (default `1024`), `hybrid.compression_tail_lines` (default `3`), `hybrid.log_routing` (default `false`).
- [x] 1.4 Wire the block into `Config.Info` and rely on the existing schema decode for explicit, user-friendly validation errors on malformed values.

## 2. Cheap-Model Resolution

- [x] 2.1 Add a cheap-model resolver that reads `hybrid.cheap_model` and resolves it through the existing catalog/credential lookup used by `SessionRunnerModel`.
- [x] 2.2 Add a pure `resolveModel(taskType, { main, cheap, settings })` selector that returns the cheap model when hybrid is active and the task type is lightweight, else the main model.
- [x] 2.3 Make resolution silently fall back to the main model when `hybrid.enabled` is false or `cheap_model` does not resolve.

## 3. Routing Integration Points

- [x] 3.2 Route compaction/summarization in `packages/core/src/session/compaction.ts` through `resolveModel("compaction")` (the only live lightweight LLM call site in current V2).
- [x] 3.6 Add a test confirming the primary turn in `session/runner/llm.ts` always resolves to the main model and never calls the cheap resolver.

### Deferred (no LLM call site exists in current V2)

- [ ] 3.1 (DEFERRED) Route session title generation through `resolveModel("title")`. Blocked: V2 has no title-generation LLM call (`session/runner/llm.ts` lists it as an unchecked TODO). `resolveModel` already accepts `"title"`; wiring is a one-liner once the call site lands.
- [ ] 3.3 (DEFERRED) Route "complete" calls through `resolveModel("complete")`. Blocked: no "complete" tool or call site exists in V2.
- [ ] 3.4 (DEFERRED) Route webfetch result processing through `resolveModel("webfetch")`. Blocked: `tool/webfetch.ts` returns raw markdown/text with no LLM post-processing pass.
- [ ] 3.5 (DEFERRED) Route websearch result processing through `resolveModel("websearch")`. Blocked: `tool/websearch.ts` returns raw provider text ("V2 invocation context does not safely expose the model yet").

## 4. Compression Module + Templates

- [x] 4.1 Create a focused compression module under `packages/core/src/hybrid` for the tool-output compression pass.
- [x] 4.2 Implement the EXTRACT template (grep/glob/bash → key lines plus file/line refs).
- [x] 4.3 Implement the SUMMARIZE template (read/prose → 3-6 bullets).
- [x] 4.4 Implement the FILTER template (logs/diffs → matching items only).
- [x] 4.5 Implement a pure `selectTemplate(toolName, content)` function preferring EXTRACT/FILTER over SUMMARIZE for code.

## 5. Threshold, Tail, and Gating

- [x] 5.1 Apply the line-count threshold gate so only outputs above `compression_threshold_lines` are compressed.
- [x] 5.3 Append the last `compression_tail_lines` lines of the original output verbatim to the compressed result.
- [x] 5.4 Bound the compression call by `compression_timeout_ms` and `compression_max_tokens`.

### Deferred (depends on unmerged sibling + absent seam)

- [ ] 5.2 (DEFERRED) Hook compression into the live tool runtime so grep/glob/bash/read outputs pass through the gate before reaching the main model. Blocked: the tool-output pipeline ordering is owned by the unmerged `context-safety-net` change, and the compression seam (`tool-output-store.ts` `bound`, or the `settle` path in `session/runner/llm.ts`) needs the tool name threaded plus an LLM dependency the storage service does not currently carry. The §4-§6 engine is built call-ready so this becomes a thin wiring step once `context-safety-net` lands.

## 6. Silent Fallback Handling

- [x] 6.1 Wrap the compression call so any error, timeout, or empty/invalid result returns the original raw output.
- [x] 6.2 Ensure fallback never surfaces errors to the user and never partially applies compression.
- [x] 6.3 Emit routing/compression decision logs only when `hybrid.log_routing` is `true`.

## 7. Unit Tests

- [x] 7.1 Test routing decisions: each lightweight task type routes to cheap model when active; main model when disabled or cheap_model missing.
- [x] 7.2 Test that the primary-turn task type always resolves to the main model.
- [x] 7.3 Test template selection by tool name (grep/glob/bash → EXTRACT, read → SUMMARIZE, logs/diffs → FILTER).
- [x] 7.4 Test the line-count threshold gate (below passes through, above compresses).
- [x] 7.5 Test tail-line preservation (last N lines appear verbatim).
- [x] 7.6 Test silent fallback on timeout, error, and empty result.

## 8. Integration Test

- [x] 8.1 Add a module-level integration test of the compression engine: hybrid enabled, a large grep output compressed via a stubbed cheap model with tail preserved, and a forced cheap-model failure falling back to raw output. (Full session-level e2e is deferred with §5.2 until the live runtime hook lands.)

## 9. Docs

- [x] 9.1 Update the config reference / docs to document the `hybrid` block, defaults, and the opt-in default-off behavior.
- [x] 9.2 Document the compression-accuracy trade-off, the gating guidance (large low-density outputs only, prefer EXTRACT/FILTER for code), and the currently-deferred routing/runtime-hook scope.
