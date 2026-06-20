# hybrid-routing

> Delivery note (2026-06-19): this change implements the enable gate, the
> `resolveModel` selector, compaction routing, routing logging, and main-model
> preservation. The title / complete / webfetch / websearch routing
> requirements are part of the capability contract but are DEFERRED because no
> such LLM call site exists in the current V2 port (see `design.md`
> "Call-site audit"). They are listed under "Deferred Requirements" below and
> are not satisfied by this change.

## ADDED Requirements

### Requirement: Hybrid Routing Enable Gate

The system SHALL route lightweight tasks to the cheap model ONLY when `hybrid.enabled` is `true` AND `hybrid.cheap_model` resolves to a valid `{ providerID, modelID }`. If either condition is unmet, the system MUST use the main model for all tasks with no behavior change.

#### Scenario: Hybrid disabled

- **WHEN** `hybrid.enabled` is `false` and a lightweight task runs
- **THEN** the task executes on the main model and no cheap-model call is made

#### Scenario: Cheap model missing

- **WHEN** `hybrid.enabled` is `true` but `hybrid.cheap_model` is unset or does not resolve to an available provider/model
- **THEN** routing is silently disabled and the task executes on the main model

#### Scenario: Hybrid enabled with valid cheap model

- **WHEN** `hybrid.enabled` is `true` and `hybrid.cheap_model` resolves successfully
- **THEN** lightweight tasks are dispatched to the cheap model

### Requirement: Compaction and Summarization Routing

When hybrid routing is active, compaction and summarization calls SHALL be dispatched to the configured cheap model.

#### Scenario: Compaction summary routes to cheap model

- **WHEN** hybrid routing is active and a compaction/summarization pass runs
- **THEN** the summarization request is sent to the cheap model and the produced summary is used as the compacted context

### Requirement: Routing Decision Logging

When `hybrid.log_routing` is `true`, the system SHALL log each routing decision (task type and the model chosen) for diagnostics. When `false`, no routing logs MUST be emitted.

#### Scenario: Logging enabled

- **WHEN** `hybrid.log_routing` is `true` and a lightweight task is routed
- **THEN** a log entry records the task type and the model that handled it

#### Scenario: Logging disabled

- **WHEN** `hybrid.log_routing` is `false`
- **THEN** no routing decision logs are emitted

### Requirement: Main Model Preservation for Non-Lightweight Work

The system SHALL route only the enumerated lightweight task types (title, compaction/summarization, complete, webfetch/websearch processing) to the cheap model. All primary reasoning and tool-driving turns MUST remain on the main model.

#### Scenario: Primary turn stays on main model

- **WHEN** hybrid routing is active and a primary assistant turn (user-facing reasoning or tool calls) runs
- **THEN** the turn executes on the main model, not the cheap model

## Deferred Requirements

> These are part of the `hybrid-routing` capability contract but are NOT
> satisfied by this change: the V2 port has no LLM call site for them yet. The
> `resolveModel` selector already enumerates these task types, so each becomes a
> one-line wiring once its call site exists.

### Requirement: Session Title Routing

When hybrid routing is active, session title generation SHALL be dispatched to the configured cheap model instead of the main model.

#### Scenario: Title generation routes to cheap model

- **WHEN** hybrid routing is active and a session title is generated
- **THEN** the title request is sent to the cheap model and the resulting title is stored unchanged

### Requirement: Complete Call Routing

When hybrid routing is active, lightweight "complete" calls SHALL be dispatched to the configured cheap model.

#### Scenario: Complete call routes to cheap model

- **WHEN** hybrid routing is active and a "complete" call is issued
- **THEN** the completion request is sent to the cheap model

### Requirement: Webfetch and Websearch Result Processing Routing

When hybrid routing is active, post-processing of webfetch and websearch results SHALL be dispatched to the configured cheap model.

#### Scenario: Webfetch result processing routes to cheap model

- **WHEN** hybrid routing is active and a webfetch result is processed (extraction/summarization of fetched content)
- **THEN** the processing request is sent to the cheap model

#### Scenario: Websearch result processing routes to cheap model

- **WHEN** hybrid routing is active and a websearch result is processed
- **THEN** the processing request is sent to the cheap model
