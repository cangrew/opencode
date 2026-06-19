## Context

OpenCode has two independent but coordinated theme systems:

- **TUI** (`packages/tui/src/theme/`): themes are `*.json` files under `assets/` conforming to the `ThemeJson` schema (an optional `defs` color dictionary plus a flat `theme` token map). They are registered by a static import + an entry in `DEFAULT_THEMES` in `index.ts`. Each token may be a hex string, a `defs` reference, an ANSI index, or a `{ dark, light }` variant object.
- **Web/Desktop** (`packages/ui/src/theme/`): themes are `*.json` files under `themes/` conforming to the `DesktopTheme` schema (`id`, `name`, and `light`/`dark` variants built from a `palette` of seed colors plus optional `overrides`). Files are auto-discovered by a Vite `import.meta.glob`; the only manual edit is a display-name entry in `context.tsx`.

This change adds the **Gehenna** theme, modeled on the in-game Gehenna messageboard terminal from _The Talos Principle: Road to Gehenna_.

Source research: the Gehenna board is an in-fiction 1980s/90s dial-up **BBS** (ASCII graphics, upvotes, sockpuppets, shadowbanning, a leveling authority system) running on the base game's terminal UI. A faithful recreation of that terminal (`github.com/lemonyte/mla-terminal`) yields the canonical colors the palette is anchored on:

- background: pure black `#000000`
- body text (customGray): warm beige `#E0D8C4`
- interactive / input prompt (customBlue): soft sky blue `#8CCAE6`
- file/listing accent (customYellow): muted chartreuse `#CDD08D`
- debug/error in red; the classic blue-background / white-text crash screen

## Goals / Non-Goals

**Goals:**

- Ship the Gehenna theme as two background siblings so the user can compare and keep one:
  - `gehenna` ("Gehenna"): true black `#000000` background.
  - `gehenna-dim` ("Gehenna Dim"): softened warm near-black `#0c0b0a` background.
- Both siblings share one palette and one light variant; only the dark background ramp base differs.
- Anchor on the three canonical terminal colors (beige text, blue prompt, chartreuse listings) and extend with a harmonized BBS/ANSI accent set so syntax/diff/status colors are distinct and readable.
- Selectable on TUI, web, and desktop through existing pickers; both `dark` and `light` variants per theme.

**Non-Goals:**

- No new theme-selection UI, config keys, CLI flags, or commands.
- No changes to the theme engines, schemas, scale generation, or any other theme.
- No per-terminal ANSI-index tuning (truecolor assumed, as with other built-in themes).
- Not a pixel-exact screenshot copy; a faithful interpretation tuned for code readability.

## Decisions

### Two siblings for the background comparison

The dark background is the one open visual question, so it is shipped twice rather than guessed once. `gehenna` is true terminal black; `gehenna-dim` softens it to a warm near-black for longer editor sessions. Everything else (accents, light variant, all non-background tokens) is identical between them, so selecting between them isolates exactly the background choice. After the user decides, the other sibling is removed in a small follow-up. Alternative considered: a single theme with a guessed background, rejected because the user explicitly wants to compare both.

### Lore-to-color mapping (the palette identity)

| Role | Source on the board | Notes |
|---|---|---|
| background | the black terminal screen | `#000000` (gehenna) / `#0c0b0a` (gehenna-dim) |
| text | the terminal's body text (customGray) | warm beige `#E0D8C4` |
| primary | the interactive input prompt (customBlue) | soft sky blue `#8CCAE6`, the "active" accent |
| secondary | file/listing text (customYellow) | muted chartreuse `#CDD08D` |
| accent | BBS ANSI magenta (headings/keywords) | orchid `#C79BD1` |
| success | phosphor green | `#8FC97A` |
| warning | amber phosphor | `#D9B36A` |
| error | terminal/debug red | `#E0746A` |
| info | terminal teal/cyan | `#73C7C0` |

### One palette, two schemas, kept in sync via this document

The canonical hex values live in the tables below. The TUI files use the `defs` step-ramp pattern (mirroring `opencode.json`); the web/desktop files use the modern palette-based `DesktopTheme` so the engine generates full scales from the seed roles plus `accent`/`diff` and syntax `overrides`. Roles map to the same hue family on both surfaces.

### Dark is the hero; light is a shared "paper printout"

The board lives on a black screen, so dark is the reference design. The light variant is a single shared reinterpretation: the board printed on warm paper (parchment background, dark ink, darkened accents for contrast), used by both siblings.

### Canonical palette: dark accents (shared by both siblings)

TUI `defs` (the web palette seeds reference the same hexes):

| def | hex | role |
|---|---|---|
| darkStep9 | `#8CCAE6` | primary (blue prompt) |
| darkStep10 | `#a6d8ee` | primary bright/hover |
| darkStep11 | `#8f897b` | textMuted (dimmed beige) |
| darkStep12 | `#E0D8C4` | text (warm beige) |
| darkSecondary | `#CDD08D` | secondary (chartreuse listings) |
| darkAccent | `#C79BD1` | accent (orchid/magenta) |
| darkRed | `#E0746A` | error |
| darkOrange | `#D9B36A` | warning (amber) |
| darkGreen | `#8FC97A` | success |
| darkCyan | `#73C7C0` | info |
| darkYellow | `#CDD08D` | markdown emphasis / syntaxType |

### Canonical palette: dark background ramp (differs only in steps 1-3)

| def | `gehenna` | `gehenna-dim` | role |
|---|---|---|---|
| darkStep1 | `#000000` | `#0c0b0a` | background |
| darkStep2 | `#0a0a09` | `#151412` | backgroundPanel / menu |
| darkStep3 | `#131312` | `#1d1c19` | backgroundElement |
| darkStep4 | `#1c1c1a` | `#1c1c1a` | (ramp) |
| darkStep5 | `#252522` | `#252522` | (ramp) |
| darkStep6 | `#30302b` | `#30302b` | borderSubtle |
| darkStep7 | `#3f3f38` | `#3f3f38` | border |
| darkStep8 | `#54544a` | `#54544a` | borderActive |

### Canonical palette: light variant (shared "paper printout")

| def | hex | role |
|---|---|---|
| lightStep1 | `#f5f1e6` | background (parchment) |
| lightStep2 | `#efe9d9` | backgroundPanel / menu |
| lightStep3 | `#e8e1cc` | backgroundElement |
| lightStep4 | `#ded5bd` | (ramp) |
| lightStep5 | `#d3c9ac` | (ramp) |
| lightStep6 | `#c6b998` | borderSubtle |
| lightStep7 | `#b0a07e` | border |
| lightStep8 | `#8f7e5d` | borderActive |
| lightStep9 | `#2f7aa6` | primary (blue, darkened) |
| lightStep10 | `#246088` | primary darker |
| lightStep11 | `#7a715c` | textMuted |
| lightStep12 | `#2b2a24` | text (warm near-black ink) |
| lightSecondary | `#6f7a2f` | secondary (olive) |
| lightAccent | `#8a4f97` | accent (orchid darkened) |
| lightRed | `#c2483b` | error |
| lightOrange | `#9c7320` | warning (amber darkened) |
| lightGreen | `#4f8a3a` | success |
| lightCyan | `#2f8b84` | info |
| lightYellow | `#6f7a2f` | markdown emphasis / syntaxType |

### TUI token map (`theme`, identical for both siblings)

Core roles: `primary`→step9, `secondary`→secondary, `accent`→accent, `error`→red, `warning`→orange, `success`→green, `info`→cyan, `text`→step12, `textMuted`→step11, `background`→step1, `backgroundPanel`→step2, `backgroundElement`→step3, `border`→step7, `borderActive`→step8, `borderSubtle`→step6. Optional: `backgroundMenu`→step2, `selectedListItemText`→step1, `thinkingOpacity`→`0.5`.

Markdown: `markdownText`→step12, `markdownHeading`→accent, `markdownLink`→step9, `markdownLinkText`→cyan, `markdownCode`→green, `markdownBlockQuote`→yellow, `markdownEmph`→yellow, `markdownStrong`→orange, `markdownHorizontalRule`→step11, `markdownListItem`→step9, `markdownListEnumeration`→cyan, `markdownImage`→step9, `markdownImageText`→cyan, `markdownCodeBlock`→step12.

Syntax: `syntaxComment`→step11, `syntaxKeyword`→accent, `syntaxFunction`→step9, `syntaxVariable`→red, `syntaxString`→green, `syntaxNumber`→orange, `syntaxType`→yellow, `syntaxOperator`→cyan, `syntaxPunctuation`→step12.

Diff (explicit hex per variant, dark / light): `diffAdded` `#8FC97A`/`#4f8a3a`; `diffRemoved` `#E0746A`/`#c2483b`; `diffContext` `#8f897b`/`#7a715c`; `diffHunkHeader` `#C79BD1`/`#8a4f97`; `diffHighlightAdded` `#a9d694`/`#3c6e2b`; `diffHighlightRemoved` `#ec8a80`/`#d85a4c`; `diffAddedBg` `#111b0e`/`#dfe9cf`; `diffRemovedBg` `#1f1310`/`#f3dcd4`; `diffContextBg` step2/step2; `diffLineNumber` `#6f6a5d`/`#978f79`; `diffAddedLineNumberBg` `#0e1709`/`#d2dcc0`; `diffRemovedLineNumberBg` `#1b100d`/`#ecccc2`.

### Web/Desktop palette map (`DesktopTheme`, per sibling)

`{ "$schema": "https://opencode.ai/desktop-theme.json", "name": "Gehenna" | "Gehenna Dim", "id": "gehenna" | "gehenna-dim", "light": {...}, "dark": {...} }`.

- **dark.palette**: `neutral` (`#0a0a09` for `gehenna`, `#0c0b0a` for `gehenna-dim`), `ink` `#E0D8C4`, `primary` `#8CCAE6`, `accent` `#C79BD1`, `success` `#8FC97A`, `warning` `#D9B36A`, `error` `#E0746A`, `info` `#73C7C0`, `diffAdd` `#8FC97A`, `diffDelete` `#E0746A`. For `gehenna`, if the generated surface scale is not black enough, add an override forcing the root background to `#000000`.
- **dark.overrides**: `syntax-comment` `#8f897b`, `syntax-keyword` `#C79BD1`, `syntax-string` `#8FC97A`, `syntax-primitive` `#D9B36A`, `syntax-property` `#73C7C0`, `syntax-constant` `#8CCAE6`.
- **light.palette** (shared): `neutral` `#f5f1e6`, `ink` `#2b2a24`, `primary` `#2f7aa6`, `accent` `#8a4f97`, `success` `#4f8a3a`, `warning` `#9c7320`, `error` `#c2483b`, `info` `#2f8b84`, `diffAdd` `#5f9a47`, `diffDelete` `#c2483b`.
- **light.overrides** (shared): `syntax-comment` `#978f79`, `syntax-keyword` `#8a4f97`, `syntax-string` `#4f8a3a`, `syntax-primitive` `#9c7320`, `syntax-property` `#2f8b84`, `syntax-constant` `#2f7aa6`.

### Spelling

The request spelled it "Gahena"; the canonical title is **Gehenna**. The ids (`gehenna`, `gehenna-dim`) and display names ("Gehenna", "Gehenna Dim") use the correct spelling.

## Risks / Trade-offs

- **Two near-identical themes in the picker** → Intentional and temporary, for the background comparison; the loser is removed after the user decides. Display names make the difference obvious ("Gehenna" vs "Gehenna Dim").
- **True black surfaces collapsing the web scale generator** → The `gehenna` web variant uses a near-black `neutral` plus, if needed, a background override to `#000000`; verify the generated panel/element steps stay distinguishable at apply time.
- **Legibility of warm beige + cool accents on black** → Body text is beige `#E0D8C4` (dark) / ink `#2b2a24` (light); blue/yellow/orchid are reserved for accents, headings, links, and syntax. Validate text-on-background and status-on-background contrast at apply.
- **Theme files drifting out of sync** → This design doc is the single canonical source of the hex values; both surfaces and both siblings are authored from these tables, and a TUI load test guards the structure.
- **A light variant of a black-terminal theme feeling off-brand** → Framed as the board printed on warm paper, shared by both siblings, with darkened accents for contrast.

## Migration Plan

Purely additive. Deploy: add the four JSON files (two siblings x two surfaces) and the registration edits in `index.ts` and `context.tsx`. Rollback: delete those JSON files and revert the two registration edits; no data, config, or schema migration. Follow-up after the comparison: delete the unchosen sibling's two JSON files, its registrations, and its test entry.

## Open Questions

None blocking. The exact black-level of the web `gehenna` background (pure override vs generated near-black) is finalized during apply against the live scale generator.
