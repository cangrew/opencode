## ADDED Requirements

### Requirement: Compute message cost from model pricing

The system SHALL compute the monetary cost of each assistant message from the producing model's pricing and the message's token usage. OpenCode model prices are USD per 1,000,000 tokens. The cost MUST be `((input * inputPrice) + ((output + reasoning) * outputPrice) + (cacheRead * cacheReadPrice) + (cacheWrite * cacheWritePrice)) / 1_000_000`, where reasoning tokens are charged at the output price unless the model schema later provides separate reasoning pricing.

#### Scenario: Cost computed from tokens and pricing

- **WHEN** an assistant message reports its token usage and the model has known pricing
- **THEN** the system sets the message cost to the sum of each token category multiplied by its USD-per-million-token price and divided by 1,000,000

#### Scenario: Reasoning tokens use output price

- **WHEN** an assistant message reports visible output tokens and reasoning tokens
- **THEN** the system charges both token categories at the model's output price

#### Scenario: Unknown pricing yields zero cost

- **WHEN** the producing model has no known pricing
- **THEN** the message cost is 0 and the system does not raise an error

### Requirement: Apply tiered pricing by context size

When a model defines tiered pricing, for example a higher rate above a context size threshold, the system SHALL select the highest price tier whose threshold is less than or equal to the current request context size. The request context size MUST be based on the current provider request's input tokens, including cache read and cache write tokens, and MUST NOT use cumulative session token totals.

#### Scenario: Large context uses the higher tier

- **WHEN** a model defines an over threshold price tier and the request context exceeds that threshold
- **THEN** the system uses the over threshold prices to compute the cost

#### Scenario: Small context uses the base tier

- **WHEN** the request context is below every defined threshold
- **THEN** the system uses the base prices to compute the cost

#### Scenario: Cumulative session total does not select tier

- **WHEN** a session has accumulated many turns but the current request context is below every defined threshold
- **THEN** the system uses the base prices for that message

### Requirement: Aggregate cost into session total

The system SHALL accumulate message cost into the session's running cost total so the session reflects total spend. The aggregate MUST remain consistent when V2 assistant messages are added, removed, edited, or regenerated.

#### Scenario: Session total increases with each message

- **WHEN** a new assistant message with non zero cost is recorded
- **THEN** the session cost total increases by that message's cost

#### Scenario: Removing a message reduces the total

- **WHEN** an assistant message is removed from a session
- **THEN** the session cost total decreases by that message's cost

#### Scenario: Regenerating a message replaces previous cost

- **WHEN** an assistant message is regenerated and the previous assistant message is removed or superseded
- **THEN** the session total removes the previous message cost and adds the regenerated message cost exactly once
