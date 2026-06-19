import { For } from "solid-js"
import { useTheme, tint } from "../context/theme"

// "GEHENNA" rendered in the figlet "Bloody" font (authentic glyphs + kerning).
// opentui rasterizes glyphs from a native font atlas. The full block (█) and the
// vertical half-blocks (▀ ▄) render at a reliable cell width (the default logo uses
// them), so they are kept as-is to preserve the smooth top/bottom edges. The glyphs
// opentui mishandles, the shades (░ ▒ ▓) and side-halves (▐ ▌), are redrawn as full
// blocks with their intensity encoded as the foreground color, keeping the gradient.
const ART = [
  "  ▄████ ▓█████  ██░ ██ ▓█████  ███▄    █  ███▄    █  ▄▄▄",
  " ██▒ ▀█▒▓█   ▀ ▓██░ ██▒▓█   ▀  ██ ▀█   █  ██ ▀█   █ ▒████▄",
  "▒██░▄▄▄░▒███   ▒██▀▀██░▒███   ▓██  ▀█ ██▒▓██  ▀█ ██▒▒██  ▀█▄",
  "░▓█  ██▓▒▓█  ▄ ░▓█ ░██ ▒▓█  ▄ ▓██▒  ▐▌██▒▓██▒  ▐▌██▒░██▄▄▄▄██",
  "░▒▓███▀▒░▒████▒░▓█▒░██▓░▒████▒▒██░   ▓██░▒██░   ▓██░ ▓█   ▓██▒",
  " ░▒   ▒ ░░ ▒░ ░ ▒ ░░▒░▒░░ ▒░ ░░ ▒░   ▒ ▒ ░ ▒░   ▒ ▒  ▒▒   ▓▒█░",
  "  ░   ░  ░ ░  ░ ▒ ░▒░ ░ ░ ░  ░░ ░░   ░ ▒░░ ░░   ░ ▒░  ▒   ▒▒ ░",
  "░ ░   ░    ░    ░  ░░ ░   ░      ░   ░ ░    ░   ░ ░   ░   ▒",
  "      ░    ░  ░ ░  ░  ░   ░  ░         ░          ░       ░  ░",
]

// Maps a source glyph to the glyph opentui should actually draw plus the foreground
// intensity (0..1, fraction toward the theme foreground). Shades dim toward the
// background; side-halves fall back to a full block; vertical half-blocks and full
// blocks are preserved.
function cell(char: string): { glyph: string; factor: number } | null {
  if (char === " ") return null
  if (char === "░") return { glyph: "█", factor: 0.3 }
  if (char === "▒") return { glyph: "█", factor: 0.55 }
  if (char === "▓") return { glyph: "█", factor: 0.78 }
  if (char === "▐" || char === "▌") return { glyph: "█", factor: 1 }
  if (char === "▀" || char === "▄") return { glyph: char, factor: 1 }
  return { glyph: "█", factor: 1 }
}

export function GehennaTuiLogo() {
  const { theme } = useTheme()

  // Solid cells use the theme foreground; shades fade from the foreground toward the
  // background by their intensity. Anchoring on theme tokens keeps the logo on-theme
  // and adapts to both the light and dark variants.
  const ink = (factor: number) => tint(theme.background, theme.text, factor)

  return (
    <box backgroundColor={theme.background}>
      <For each={ART}>
        {(line) => (
          <box flexDirection="row">
            <For each={Array.from(line)}>
              {(char) => {
                const item = cell(char)
                if (item === null)
                  return (
                    <text bg={theme.background} selectable={false}>
                      {" "}
                    </text>
                  )
                return (
                  <text fg={ink(item.factor)} bg={theme.background} selectable={false}>
                    {item.glyph}
                  </text>
                )
              }}
            </For>
          </box>
        )}
      </For>
    </box>
  )
}
