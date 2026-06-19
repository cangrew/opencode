## ADDED Requirements

### Requirement: Gehenna themes are registered built-ins

The system SHALL provide two built-in sibling themes derived from the in-game Gehenna messageboard terminal: `gehenna` (display name "Gehenna") and `gehenna-dim` (display name "Gehenna Dim"), available without any user-supplied theme file. Both MUST be discoverable through the existing built-in theme registries on every surface that exposes built-in themes (TUI, web, and desktop) and MUST be selectable through the existing theme-selection flow on each surface.

#### Scenario: Both themes appear in the built-in registry

- **WHEN** the application enumerates its built-in themes
- **THEN** an entry with id `gehenna` (name "Gehenna") and an entry with id `gehenna-dim` (name "Gehenna Dim") are both present

#### Scenario: User selects a Gehenna theme

- **WHEN** a user selects `gehenna` or `gehenna-dim` through the existing theme picker on the TUI, web, or desktop surface
- **THEN** the application applies that theme's colors and persists the selection through the same mechanism used for any other built-in theme

#### Scenario: No new selection surface is introduced

- **WHEN** the Gehenna themes are added
- **THEN** no new config key, command, or selection UI is required to discover or activate them beyond the existing theme registries and picker

### Requirement: Sibling themes differ only by dark background

The two sibling themes SHALL be identical in every theme token except the dark-variant background ramp, so selecting between them isolates only the background-darkness choice. The `gehenna` dark background MUST be true terminal black (`#000000`) and the `gehenna-dim` dark background MUST be a softened warm near-black (`#0c0b0a`). All accent, status, syntax, diff, markdown, and light-variant colors MUST be the same for both.

#### Scenario: Backgrounds differ

- **WHEN** the dark variants of `gehenna` and `gehenna-dim` are compared
- **THEN** `gehenna` resolves its base background to `#000000` and `gehenna-dim` resolves its base background to `#0c0b0a`

#### Scenario: Non-background colors match

- **WHEN** any non-background token (primary, secondary, accent, status, syntax, diff, markdown, or any light-variant color) is compared between the two siblings
- **THEN** both siblings resolve that token to the same color

### Requirement: Each Gehenna theme provides dark and light variants

Each Gehenna theme SHALL define both a `dark` variant and a `light` variant. The dark variant is the primary expression (the board on its black terminal screen) and the light variant is a shared "paper printout" reading (warm parchment background, dark ink, darkened accents). Both variants MUST resolve through the same mode-switching mechanism used by other built-in themes.

#### Scenario: Dark variant resolves

- **WHEN** the active appearance mode is dark and a Gehenna theme is selected
- **THEN** every theme token resolves to the dark-variant color value

#### Scenario: Light variant resolves

- **WHEN** the active appearance mode is light and a Gehenna theme is selected
- **THEN** every theme token resolves to the light-variant color value

### Requirement: Each Gehenna theme defines a complete, valid TUI token set

Each TUI Gehenna theme file SHALL conform to the TUI `ThemeJson` schema and MUST provide a value for every required `ThemeColor` token (core roles, backgrounds, borders, diff, markdown, and syntax tokens) for both the dark and light variants. All color values MUST be valid (hex, a defined `defs` reference, or an ANSI index), and any `defs` references MUST resolve without a circular reference.

#### Scenario: All required tokens are present

- **WHEN** the TUI theme loader parses `gehenna.json` or `gehenna-dim.json`
- **THEN** it loads without error and every required `ThemeColor` token resolves to a concrete color for both variants

#### Scenario: No circular color references

- **WHEN** the TUI theme loader resolves a Gehenna theme's `defs` and token references
- **THEN** resolution completes without detecting a circular reference

### Requirement: Each Gehenna theme defines a complete web/desktop palette

Each web/desktop Gehenna theme file SHALL conform to the `DesktopTheme` schema, declaring `name`, a unique `id` (`gehenna` or `gehenna-dim`), and both `light` and `dark` variants. Each variant MUST supply every required `palette` key (`neutral`, `ink`, `primary`, `success`, `warning`, `error`, `info`) and MAY supply the optional expressive keys (`accent`, `diffAdd`, `diffDelete`) and syntax `overrides`. All color values MUST be valid hex.

#### Scenario: Desktop theme validates against the schema

- **WHEN** the web/desktop theme system loads `gehenna.json` or `gehenna-dim.json`
- **THEN** it validates against the `DesktopTheme` schema and generates the full color scale for both variants without error

#### Scenario: Required palette keys are present per variant

- **WHEN** either the light or dark variant of either sibling is inspected
- **THEN** all required palette keys are present and resolve to valid hex colors

### Requirement: Terminal-board palette identity

The Gehenna themes SHALL express one coherent palette derived from the in-game Gehenna terminal: warm beige body text (`#E0D8C4`) on a black screen, a soft-blue interactive/primary (`#8CCAE6`) from the input prompt, a muted chartreuse secondary (`#CDD08D`) from the file listings, extended with a harmonized BBS/ANSI accent set (phosphor green success, amber warning, terminal red error, teal info, orchid/magenta accent). Color roles MUST map to the same hue family on every surface so the theme reads as the same theme everywhere. Foreground-on-background pairings MUST remain legible (text against background, and accent/status colors against their backgrounds) in both variants.

#### Scenario: Hue roles match across surfaces

- **WHEN** the primary, secondary, success, warning, error, info, and accent roles are compared between the TUI and the web/desktop definitions
- **THEN** each role uses the same hue family on both surfaces (for example, primary is the soft-blue prompt hue and secondary is the chartreuse listing hue in both)

#### Scenario: Default body text stays legible

- **WHEN** default body text is rendered on the theme's primary background in either variant
- **THEN** the text color contrasts clearly enough to be comfortably readable

### Requirement: Active Gehenna theme shows a themed new-chat wordmark

When a Gehenna theme (`gehenna` or `gehenna-dim`) is the active theme, the new-chat/home screen SHALL display a Gehenna-specific wordmark (the word "GEHENNA" in the figlet "Bloody" style) in place of the default OpenCode logo, on both the TUI new-chat screen and the web/desktop new-session view. The wordmark MUST take its colors from the active theme's tokens (not hardcoded values) so it tracks the dark and light variants. When any non-Gehenna theme is active, the default logo MUST be shown unchanged.

#### Scenario: Gehenna theme swaps the new-chat logo

- **WHEN** the active theme is `gehenna` or `gehenna-dim` and the new-chat screen is shown
- **THEN** the Gehenna "GEHENNA" wordmark is rendered in place of the default OpenCode logo, colored from the active theme tokens

#### Scenario: Other themes keep the default logo

- **WHEN** any theme other than `gehenna` or `gehenna-dim` is active and the new-chat screen is shown
- **THEN** the default OpenCode logo is rendered unchanged

### Requirement: Gehenna addition does not alter existing themes

Adding the Gehenna themes SHALL be purely additive. The default theme, all other built-in themes, and any user-supplied custom themes MUST behave exactly as before, and no existing theme id or display name may change.

#### Scenario: Existing themes unchanged

- **WHEN** the Gehenna themes are registered
- **THEN** the set of previously available themes and the default theme selection remain unchanged

#### Scenario: No id collision

- **WHEN** the built-in registries are loaded
- **THEN** the `gehenna` and `gehenna-dim` ids do not collide with any existing built-in or user theme id
