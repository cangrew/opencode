import { describe, expect } from "bun:test"
import { Duration, Effect } from "effect"
import { Model } from "@opencode-ai/llm"
import { route } from "@opencode-ai/llm/protocols/openai-chat"
import { HybridCompression } from "@opencode-ai/core/hybrid/compression"
import { HybridSettings } from "@opencode-ai/core/hybrid/settings"
import { it } from "../lib/effect"

const cheap = Model.make({ provider: "anthropic", id: "cheap-model", route })

const settings = (over: Partial<HybridSettings.Info> = {}): HybridSettings.Info => ({
  ...HybridSettings.DEFAULTS,
  enabled: true,
  ...over,
})

const lines = (count: number, prefix = "line") =>
  Array.from({ length: count }, (_, i) => `${prefix} ${i}`).join("\n")

const ok = (body: string): HybridCompression.Compressor => () => Effect.succeed(body)

describe("HybridCompression.compress", () => {
  it.live("passes output through unchanged when below the threshold", () =>
    Effect.gen(function* () {
      let calls = 0
      const compressor: HybridCompression.Compressor = () => {
        calls++
        return Effect.succeed("SHOULD NOT RUN")
      }
      const output = lines(5)
      const result = yield* HybridCompression.compress({ toolName: "grep", output, settings: settings(), cheap }, compressor)
      expect(result).toBe(output)
      expect(calls).toBe(0)
    }),
  )

  it.live("passes output through unchanged when hybrid is disabled", () =>
    Effect.gen(function* () {
      const output = lines(100)
      const result = yield* HybridCompression.compress(
        { toolName: "grep", output, settings: settings({ enabled: false }), cheap },
        ok("COMPRESSED"),
      )
      expect(result).toBe(output)
    }),
  )

  it.live("passes output through unchanged when no cheap model resolved", () =>
    Effect.gen(function* () {
      const output = lines(100)
      const result = yield* HybridCompression.compress(
        { toolName: "grep", output, settings: settings(), cheap: undefined },
        ok("COMPRESSED"),
      )
      expect(result).toBe(output)
    }),
  )

  it.live("compresses and preserves the last N lines verbatim when above the threshold", () =>
    Effect.gen(function* () {
      const output = lines(100)
      const result = yield* HybridCompression.compress(
        { toolName: "grep", output, settings: settings({ compressionTailLines: 3 }), cheap },
        ok("COMPRESSED BODY"),
      )
      expect(result).toContain("COMPRESSED BODY")
      expect(result).toContain("line 97\nline 98\nline 99")
    }),
  )

  it.live("falls back to raw output when the cheap model errors", () =>
    Effect.gen(function* () {
      const output = lines(100)
      const boom: HybridCompression.Compressor = () => Effect.fail("boom")
      const result = yield* HybridCompression.compress({ toolName: "grep", output, settings: settings(), cheap }, boom)
      expect(result).toBe(output)
    }),
  )

  it.live("falls back to raw output on an empty/whitespace result", () =>
    Effect.gen(function* () {
      const output = lines(100)
      const result = yield* HybridCompression.compress(
        { toolName: "grep", output, settings: settings(), cheap },
        ok("   \n  "),
      )
      expect(result).toBe(output)
    }),
  )

  it.live("falls back to raw output when the cheap model times out", () =>
    Effect.gen(function* () {
      const output = lines(100)
      const slow: HybridCompression.Compressor = () =>
        Effect.sleep(Duration.seconds(30)).pipe(Effect.as("LATE"))
      const result = yield* HybridCompression.compress(
        { toolName: "grep", output, settings: settings({ compressionTimeoutMs: 10 }), cheap },
        slow,
      )
      expect(result).toBe(output)
    }),
  )

  it.live("integration: large grep output compressed with tail, forced failure falls back to raw", () =>
    Effect.gen(function* () {
      const output = lines(200, "src/file.ts:")
      const compressed = yield* HybridCompression.compress(
        { toolName: "grep", output, settings: settings({ compressionTailLines: 2 }), cheap },
        ok("- key matches extracted"),
      )
      expect(compressed).toContain("- key matches extracted")
      expect(compressed).toContain("src/file.ts: 198\nsrc/file.ts: 199")
      expect(HybridCompression.lineCount(compressed)).toBeLessThan(HybridCompression.lineCount(output))

      const failed = yield* HybridCompression.compress(
        { toolName: "grep", output, settings: settings(), cheap },
        () => Effect.fail(new Error("provider down")),
      )
      expect(failed).toBe(output)
    }),
  )
})
