## ADDED Requirements

### Requirement: Capture OpenAI subscription usage from responses

The system SHALL extract subscription usage windows from OpenAI ChatGPT/Codex responses. It SHALL read the primary and secondary windows from the `x-codex-primary-*` and `x-codex-secondary-*` response headers (used percent, window minutes, reset seconds) on successful responses and usage-limit errors, and, when present, from the `rate_limits` snapshot in streamed terminal response events. Each captured window MUST record used percent, window duration in minutes, and an absolute reset time.

#### Scenario: Response includes codex rate limit headers

- **WHEN** an OpenAI subscription response returns `x-codex-primary-used-percent`, `x-codex-primary-window-minutes`, and `x-codex-primary-reset-after-seconds` headers
- **THEN** the system records a primary window with the parsed used percent, window minutes, and a reset time computed from the current time plus the reset seconds

#### Scenario: Usage limit error includes codex headers

- **WHEN** an OpenAI subscription request fails with a usage-limit response that includes `x-codex-*` headers
- **THEN** the system records the reported subscription windows before surfacing the request failure

#### Scenario: Stream includes rate limit snapshot

- **WHEN** an OpenAI subscription stream terminal event includes a `rate_limits` snapshot
- **THEN** the system records the primary and secondary windows from the snapshot using the shared window shape

#### Scenario: Response omits subscription usage

- **WHEN** a response contains no `x-codex-*` headers and no `rate_limits` snapshot, for example from an API key provider
- **THEN** the system records no subscription usage and leaves any previously stored snapshot unchanged

### Requirement: Persist latest usage snapshot per account

The system SHALL store the most recent subscription usage snapshot keyed by provider and account, so usage persists across requests and sessions. A newer snapshot MUST replace the previous snapshot for the same provider and account based on capture time, even when a rolling-window reset causes used percent to decrease.

#### Scenario: Newer snapshot replaces older after usage increases

- **WHEN** a later response for the same account reports a higher primary used percent
- **THEN** the stored snapshot for that account reflects the newer used percent and reset time

#### Scenario: Newer snapshot replaces older after window reset

- **WHEN** a later response for the same account reports a lower primary used percent with a newer capture time
- **THEN** the stored snapshot for that account reflects the lower used percent and new reset time

#### Scenario: Older snapshot cannot overwrite newer

- **WHEN** a stale snapshot for the same account is processed after a newer snapshot has already been stored
- **THEN** the stored snapshot remains the newer snapshot

#### Scenario: Usage is scoped per account

- **WHEN** two distinct accounts each produce usage snapshots
- **THEN** the system stores and returns them independently without one overwriting the other

### Requirement: Provider agnostic usage model

The subscription usage record SHALL be provider agnostic. It MUST identify the provider and account, and represent usage as an optional primary window and an optional secondary window, each with used percent, window minutes, and reset time. Adding a new provider MUST NOT require changing the stored shape.

#### Scenario: OpenAI snapshot uses the shared shape

- **WHEN** an OpenAI snapshot is stored
- **THEN** it is recorded with a provider identifier, the account id, and the shared primary and secondary window shape

#### Scenario: Window fields are optional

- **WHEN** a provider reports only a primary window
- **THEN** the secondary window is absent and consumers treat it as unknown rather than as zero usage

### Requirement: Resolve account identity before persistence

The system SHALL associate each subscription usage snapshot with the authenticated provider account that produced it. For OpenAI ChatGPT/Codex, it MUST use the ChatGPT account identifier when available and MUST NOT merge snapshots from different authenticated accounts. When no stable account identifier is available, the system MUST NOT persist the snapshot under a guessed account key.

#### Scenario: OpenAI account id is available

- **WHEN** an OpenAI subscription request is made with authenticated account metadata
- **THEN** the captured usage snapshot is stored under the OpenAI provider and that account id

#### Scenario: Account id is unavailable

- **WHEN** subscription usage is captured but no stable account id can be resolved
- **THEN** the system skips persistence and does not emit a usage update event

### Requirement: Expose subscription usage to clients

The system SHALL expose the current subscription usage over the API and SHALL emit a global real time event when a stored snapshot changes, so clients can hydrate on startup and render live usage without polling.

#### Scenario: Client reads current usage

- **WHEN** a client requests subscription usage for an OpenAI provider/account pair
- **THEN** the API returns the latest stored snapshot, or an empty result when none has been captured

#### Scenario: Client lists current usage

- **WHEN** a client starts and requests subscription usage snapshots
- **THEN** the API returns the latest stored snapshots keyed by provider and account, or an empty list when none have been captured

#### Scenario: Live update on change

- **WHEN** a new snapshot is stored for an account
- **THEN** the system emits a global subscription usage update event carrying the new snapshot

#### Scenario: Unchanged snapshot does not emit duplicate update

- **WHEN** a parsed snapshot is identical to the stored snapshot for the same provider and account
- **THEN** the system may refresh internal capture metadata but does not emit a duplicate client update event
