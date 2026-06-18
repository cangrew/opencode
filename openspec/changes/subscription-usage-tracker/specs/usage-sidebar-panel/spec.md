## ADDED Requirements

### Requirement: Dedicated Usage panel in the TUI sidebar

The TUI SHALL provide a dedicated "Usage" panel in the session sidebar, registered as a sidebar feature plugin and distinct from the existing "Context" widget. The panel SHALL display the current session's cumulative token usage broken down by input, output, reasoning, and cache, the running session cost, and the current context window fill percentage.

#### Scenario: Panel shows session token usage and cost

- **WHEN** a session has recorded token usage and cost
- **THEN** the Usage panel shows the per category token counts, the total cost formatted as currency, and the context fill percentage

#### Scenario: Context fill uses current context pressure

- **WHEN** a session has accumulated more total tokens than the model context window across many turns
- **THEN** the Usage panel computes context fill from the current context pressure rather than cumulative session totals

#### Scenario: Empty session

- **WHEN** a session has no assistant messages yet
- **THEN** the Usage panel shows zero tokens and zero cost without error

### Requirement: Display OpenAI subscription limit meters

When subscription usage is available for the active OpenAI account, the Usage panel SHALL display the primary and secondary limit meters, each showing the used percent and a human readable reset countdown.

#### Scenario: Subscription meters shown

- **WHEN** the active account has a captured snapshot with a primary window at 40 percent used that resets in about 2 hours
- **THEN** the panel shows a primary meter at 40 percent with a reset countdown of about 2 hours

#### Scenario: No subscription auth

- **WHEN** the active provider uses an API key and has no subscription snapshot
- **THEN** the panel omits the subscription limit section and still shows token usage and cost

#### Scenario: Rolling window reset lowers usage

- **WHEN** a newer subscription snapshot reports a lower used percent after a rolling window reset
- **THEN** the panel updates the meter downward and shows the new reset countdown

### Requirement: Live updates

The Usage panel SHALL hydrate subscription usage from TUI sync state on startup and update reactively as new token usage and global subscription usage events arrive, without requiring the user to reopen the sidebar.

#### Scenario: Panel hydrates persisted usage

- **WHEN** opencode starts and a subscription usage snapshot was captured in a previous run
- **THEN** the Usage panel can show the subscription meters before the next model request completes

#### Scenario: Panel updates after a turn

- **WHEN** an assistant turn completes and updates token usage, cost, or subscription usage
- **THEN** the panel reflects the new values on the next render

#### Scenario: TUI plugin API exposes subscription usage

- **WHEN** a sidebar feature plugin renders the Usage panel
- **THEN** the plugin API exposes the hydrated subscription usage state needed to select the active account snapshot
