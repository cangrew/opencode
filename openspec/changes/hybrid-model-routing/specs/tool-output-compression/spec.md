# tool-output-compression

## ADDED Requirements

### Requirement: Compression Enable Gate

Tool-output compression SHALL run ONLY when `hybrid.enabled` is `true` AND `hybrid.cheap_model` resolves to a valid `{ providerID, modelID }`. Otherwise tool outputs MUST pass through unmodified.

#### Scenario: Compression disabled when hybrid off

- **WHEN** `hybrid.enabled` is `false` and a large tool output is produced
- **THEN** the raw tool output is passed to the main model unchanged and no cheap-model call is made

#### Scenario: Compression disabled when cheap model missing

- **WHEN** `hybrid.enabled` is `true` but `hybrid.cheap_model` does not resolve
- **THEN** the raw tool output is passed through unchanged

### Requirement: Line-Count Threshold Gate

The system SHALL compress a tool output ONLY when its line count exceeds the configured threshold. Outputs at or below the threshold MUST pass through verbatim. Compression MUST target large, low-density outputs and MUST NOT run on the precise-reasoning path.

#### Scenario: Output below threshold passes through

- **WHEN** a tool produces output with a line count at or below the threshold
- **THEN** the output is returned verbatim and no compression call is made

#### Scenario: Output above threshold is compressed

- **WHEN** a tool produces output whose line count exceeds the threshold
- **THEN** the compression pass runs against the cheap model before the output reaches the main model

### Requirement: Template Selection by Tool Type

The system SHALL auto-select a compression template by source tool type: EXTRACT for grep/glob/bash (key lines plus file/line references), SUMMARIZE for read/prose (3-6 bullets), and FILTER for logs/diffs (matching items only). For code-oriented outputs the system MUST prefer EXTRACT/FILTER over SUMMARIZE.

#### Scenario: Grep output selects EXTRACT

- **WHEN** a grep tool output exceeds the threshold and is compressed
- **THEN** the EXTRACT template is used and the result preserves file/line references

#### Scenario: Glob output selects EXTRACT

- **WHEN** a glob tool output exceeds the threshold and is compressed
- **THEN** the EXTRACT template is used

#### Scenario: Bash output selects EXTRACT

- **WHEN** a bash tool output exceeds the threshold and is compressed
- **THEN** the EXTRACT template is used, retaining key lines and references

#### Scenario: Read output selects SUMMARIZE

- **WHEN** a read tool output of prose exceeds the threshold and is compressed
- **THEN** the SUMMARIZE template is used and the result is 3-6 bullets

#### Scenario: Log or diff output selects FILTER

- **WHEN** a tool output recognized as logs or diffs exceeds the threshold and is compressed
- **THEN** the FILTER template is used and only matching items are retained

### Requirement: Tail-Line Preservation Anchor

The compressed result SHALL always append the last `hybrid.compression_tail_lines` lines of the original output verbatim as an anti-hallucination anchor.

#### Scenario: Last N lines preserved verbatim

- **WHEN** a tool output is compressed with `compression_tail_lines` set to N
- **THEN** the final N lines of the original output appear verbatim in the result, unaltered by the cheap model

### Requirement: Bounded Compression Call

The compression call SHALL be bounded by `hybrid.compression_timeout_ms` and `hybrid.compression_max_tokens`. A call exceeding the timeout MUST be abandoned.

#### Scenario: Compression respects max tokens

- **WHEN** a compression call runs
- **THEN** the cheap-model request is capped at `compression_max_tokens` output tokens

#### Scenario: Compression respects timeout

- **WHEN** a compression call exceeds `compression_timeout_ms`
- **THEN** the call is abandoned and fallback handling is triggered

### Requirement: Silent Fallback on Error or Timeout

On any compression error, timeout, or empty/invalid result, the system SHALL silently return the original raw tool output. Compression MUST NEVER corrupt, truncate (beyond verbatim passthrough), or replace results with malformed content.

#### Scenario: Timeout falls back to raw output

- **WHEN** a compression call times out
- **THEN** the original raw tool output is returned unchanged with no error surfaced to the user

#### Scenario: Cheap-model error falls back to raw output

- **WHEN** the cheap model returns an error or an empty result during compression
- **THEN** the original raw tool output is returned unchanged
