## Why

OpenCode ships a family of built-in themes but none modeled on the in-game **Gehenna messageboard terminal** from Croteam's _The Talos Principle: Road to Gehenna_. In the DLC, trapped AI "souls" communicate through a retro 1980s/90s dial-up BBS (ASCII graphics, upvotes, sockpuppets, shadowbanning, a leveling authority system) running on the game's signature computer terminal: warm beige text on a black screen, with soft-blue input prompts and muted chartreuse file listings. That interface is a natural, lore-grounded basis for a warm-on-black terminal theme, and it gives users a distinctive retro-BBS option alongside the existing themes.

## What Changes

- Add two built-in sibling themes that differ **only** in dark-background darkness, both kept as permanent options so users can pick whichever background they prefer:
  - **Gehenna** (id `gehenna`): true terminal black (`#000000`) background.
  - **Gehenna Dim** (id `gehenna-dim`): softened warm near-black (`#0c0b0a`) background.
- Both share one palette derived from the terminal: warm beige text (`#E0D8C4`), soft-blue interactive/primary (`#8CCAE6`), chartreuse secondary (`#CDD08D`), extended with a harmonized BBS/ANSI accent set (green, red, cyan, magenta/orchid, amber) so syntax, diffs, and status colors stay distinct and readable. Each theme provides both `dark` and `light` variants (the light variant is a shared "paper printout" reading of the board).
- Register both themes in the **TUI** system (`packages/tui/src/theme/assets/*.json` plus imports/`DEFAULT_THEMES` entries in `index.ts`) and the **web/desktop UI** system (`packages/ui/src/theme/themes/*.json` plus display-name entries in `context.tsx`).
- Replace the default OpenCode wordmark on the new-chat/home screen with a Gehenna-specific "GEHENNA" mark (figlet "Bloody" font, dripping-terminal aesthetic) whenever a Gehenna theme is active, colored from the active theme tokens. This applies on both the TUI new-chat screen and the web/desktop new-session view; every other theme keeps the default logo.
- No new selection UI, config keys, or commands: both themes are discovered through the existing built-in registries and selected with the existing theme picker.

This is additive and **not** a breaking change. Existing themes, the default theme, and user-supplied custom themes are unaffected. Both background siblings are kept as permanent built-ins.

## Capabilities

### New Capabilities

- `gehenna-theme`: Built-in "Gehenna" terminal-board themes, available and selectable across the TUI, web, and desktop surfaces, shipped as two background siblings (`gehenna`, `gehenna-dim`) that share one palette, each with dark and light variants and a complete, readable token mapping for both the TUI `ThemeJson` schema and the web/desktop `DesktopTheme` schema. When a Gehenna theme is active, the new-chat screen shows a Gehenna-specific wordmark in place of the default OpenCode logo, colored from the active theme tokens.

### Modified Capabilities

<!-- None. No existing spec-level requirements change; this is a self-contained additive theme. -->

## Impact

- **TUI** (`packages/tui`): new `src/theme/assets/gehenna.json` and `src/theme/assets/gehenna-dim.json`; edit `src/theme/index.ts` (two static imports and two `DEFAULT_THEMES` entries). New `src/component/gehenna-logo.tsx` (the themed wordmark); edit `src/routes/home.tsx` to swap it in when a Gehenna theme is active.
- **Web/Desktop UI** (`packages/ui`): new `src/theme/themes/gehenna.json` and `src/theme/themes/gehenna-dim.json` (auto-discovered by the Vite glob); edit `src/theme/context.tsx` to add the `gehenna` and `gehenna-dim` display names. Add a `GehennaMark` to `src/components/logo.tsx`.
- **Web app** (`packages/app`): edit `src/components/session/session-new-view.tsx` to render `GehennaMark` instead of the default mark when a Gehenna theme is active.
- **Tests** (`packages/tui/test/theme.test.ts`): a load/validation check that both new themes parse and expose the required tokens for both variants (no circular refs).
- No database, API, SDK, or config-schema changes. No new dependencies.
