# Tasks: Hybrid Model Routing + Tool-Output Compression

## 1. Config Schema

- [ ] 1.1 Add the `hybrid` block to the config schema in `packages/core/src/config` using Effect `Schema.Class`, with snake_case keys.
- [ ] 1.2 Add `hybrid.enabled` (boolean, default `false`) and `hybrid.cheap_model` (`{ providerID, modelID }`, optional).
- [ ] 1.3 Add `hybrid.compression_timeout_ms` (default `5000`), `hybrid.compression_max_tokens` (default `1024`), `hybrid.compression_tail_lines` (default `3`), `hybrid.log_routing` (default `false`).
- [ ] 1.4 Validate the block at config load with explicit, user-friendly errors for malformed values.

## 2. Cheap-Model Resolution

- [ ] 2.1 Add a cheap-model resolver that reads `hybrid.cheap_model` and resolves it through the existing provider/model lookup in `packages/llm`.
- [ ] 2.2 Add a `resolveModel(taskType)` helper that returns the cheap model when hybrid is active and the task type is lightweight, else the main model.
- [ ] 2.3 Make resolution silently fall back to the main model when `hybrid.enabled` is false or `cheap_model` does not resolve.

## 3. Routing Integration Points

- [ ] 3.1 Route session title generation through `resolveModel("title")`.
- [ ] 3.2 Route compaction/summarization in `packages/core/src/session/compaction.ts` through `resolveModel("compaction")`.
- [ ] 3.3 Route "complete" calls through `resolveModel("complete")`.
- [ ] 3.4 Route webfetch result processing (`packages/core/src/tool/webfetch.ts`) through `resolveModel("webfetch")`.
- [ ] 3.5 Route websearch result processing (`packages/core/src/tool/websearch.ts`) through `resolveModel("websearch")`.
- [ ] 3.6 Confirm primary turns never call `resolveModel` and always use the main model.

## 4. Compression Module + Templates

- [ ] 4.1 Create a focused compression module under `packages/core/src` for the tool-output compression pass.
- [ ] 4.2 Implement the EXTRACT template (grep/glob/bash → key lines plus file/line refs).
- [ ] 4.3 Implement the SUMMARIZE template (read/prose → 3-6 bullets).
- [ ] 4.4 Implement the FILTER template (logs/diffs → matching items only).
- [ ] 4.5 Implement a pure `selectTemplate(toolType, content)` function preferring EXTRACT/FILTER over SUMMARIZE for code.

## 5. Threshold, Tail, and Gating

- [ ] 5.1 Apply the line-count threshold gate so only outputs above the threshold are compressed.
- [ ] 5.2 Hook compression into the tool runtime so grep/glob/bash/read outputs pass through the gate before reaching the main model.
- [ ] 5.3 Append the last `compression_tail_lines` lines of the original output verbatim to the compressed result.
- [ ] 5.4 Bound the compression call by `compression_timeout_ms` and `compression_max_tokens`.

## 6. Silent Fallback Handling

- [ ] 6.1 Wrap the compression call so any error, timeout, or empty/invalid result returns the original raw output.
- [ ] 6.2 Ensure fallback never surfaces errors to the user and never partially applies compression.
- [ ] 6.3 Emit routing decision logs only when `hybrid.log_routing` is `true`.

## 7. Unit Tests

- [ ] 7.1 Test routing decisions: each lightweight task type routes to cheap model when active; main model when disabled or cheap_model missing.
- [ ] 7.2 Test that primary turns always resolve to the main model.
- [ ] 7.3 Test template selection by tool type (grep/glob/bash → EXTRACT, read → SUMMARIZE, logs/diffs → FILTER).
- [ ] 7.4 Test the line-count threshold gate (below passes through, above compresses).
- [ ] 7.5 Test tail-line preservation (last N lines appear verbatim).
- [ ] 7.6 Test silent fallback on timeout, error, and empty result.

## 8. Integration Test

- [ ] 8.1 Add an integration test exercising the end-to-end flow: hybrid enabled, a large grep output compressed via cheap model with tail preserved, and a forced cheap-model failure falling back to raw output.

## 9. Docs

- [ ] 9.1 Update the config reference / docs to document the `hybrid` block, defaults, and the opt-in default-off behavior.
- [ ] 9.2 Document the compression-accuracy trade-off and the gating guidance (large low-density outputs only, prefer EXTRACT/FILTER for code).
