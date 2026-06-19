## 1. TUI themes

- [x] 1.1 Create `packages/tui/src/theme/assets/gehenna.json` following the `ThemeJson` schema: a `defs` block with the shared dark accents (`darkStep9..12`, `darkSecondary/Accent/Red/Orange/Green/Cyan/Yellow`), the `gehenna` dark background ramp (`darkStep1` `#000000`, `darkStep2` `#0a0a09`, `darkStep3` `#131312`, `darkStep4..8` shared), and the shared light ramp (`lightStep1..12`, `lightSecondary/Accent/Red/Orange/Green/Cyan/Yellow`) from the design's canonical palette tables.
- [x] 1.2 Fill `gehenna.json`'s `theme` token map (core roles, backgrounds, borders, optional `backgroundMenu`/`selectedListItemText`/`thinkingOpacity`, markdown, syntax) using the design's TUI token map, with `{ dark, light }` `defs` references per token, plus the explicit diff hex values.
- [x] 1.3 Create `packages/tui/src/theme/assets/gehenna-dim.json` identical to `gehenna.json` except the dark background ramp base (`darkStep1` `#0c0b0a`, `darkStep2` `#151412`, `darkStep3` `#1d1c19`).
- [x] 1.4 Register both themes in `packages/tui/src/theme/index.ts`: add `import gehenna from "./assets/gehenna.json" with { type: "json" }` and `import gehennaDim from "./assets/gehenna-dim.json" with { type: "json" }`, and add `"gehenna": gehenna` and `"gehenna-dim": gehennaDim` entries to `DEFAULT_THEMES`.

## 2. Web/Desktop themes

- [x] 2.1 Create `packages/ui/src/theme/themes/gehenna.json` following the `DesktopTheme` schema: `$schema`, `name: "Gehenna"`, `id: "gehenna"`, and `light`/`dark` variants.
- [x] 2.2 Populate `gehenna.json`'s variant palettes (`neutral`, `ink`, `primary`, `accent`, `success`, `warning`, `error`, `info`, `diffAdd`, `diffDelete`) and syntax `overrides` from the design's web/desktop palette map; if the generated dark surface is not black enough, add a background override forcing `#000000`.
- [x] 2.3 Create `packages/ui/src/theme/themes/gehenna-dim.json` identical to `gehenna.json` except `name: "Gehenna Dim"`, `id: "gehenna-dim"`, and the dark `neutral` base (`#0c0b0a`, no true-black override).
- [x] 2.4 Add both display names to the `names` map in `packages/ui/src/theme/context.tsx`: `"gehenna": "Gehenna"` and `"gehenna-dim": "Gehenna Dim"`.

## 3. Themed new-chat logo

- [x] 3.1 Create `packages/tui/src/component/gehenna-logo.tsx`: render "GEHENNA" in the figlet "Bloody" font, drawing lit cells as full/half blocks colored from `theme.text` faded toward `theme.background` (so it tracks both variants), substituting opentui-unsupported shade and side-half glyphs with intensity-graded full blocks.
- [x] 3.2 Edit `packages/tui/src/routes/home.tsx` to swap `GehennaTuiLogo` in for the default `Logo` inside the `home_logo` slot when the active theme id is `gehenna` or `gehenna-dim`.
- [x] 3.3 Add a `GehennaMark` SVG to `packages/ui/src/components/logo.tsx` colored from the icon CSS variables.
- [x] 3.4 Edit `packages/app/src/components/session/session-new-view.tsx` to render `GehennaMark` instead of `Mark` when the active theme id is `gehenna` or `gehenna-dim`.

## 4. Verification

- [x] 4.1 Add a test in `packages/tui/test/theme.test.ts` that loads both `gehenna.json` and `gehenna-dim.json`, asserts they register without error, expose every required token for both variants, and resolve with no circular `defs` reference.
- [x] 4.2 Run `cd packages/tui && bun test` and confirm theme tests pass.
- [x] 4.3 Run `bun typecheck` and `bun lint` and confirm both pass.
- [x] 4.4 Launch the TUI (`bun dev`), open the theme picker, switch between "Gehenna" and "Gehenna Dim", and visually compare the true-black vs softened backgrounds with legible beige-on-black text and the blue/chartreuse/orchid accents (dark and light variants); confirm the themed wordmark renders on the new-chat screen.
- [~] 4.5 Web UI visual verification is out of scope (TUI is the target surface). The web/desktop theme files and `GehennaMark` ship as-is without a manual web check.

## 5. Sibling themes

- [x] 5.1 Both `gehenna` and `gehenna-dim` are kept as permanent built-ins; no sibling is removed.
