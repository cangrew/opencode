export * as HybridCompression from "./compression"

import { Duration, Effect } from "effect"
import type { Model } from "@opencode-ai/llm"
import type { HybridSettings } from "./settings"
import { buildPrompt, selectTemplate } from "./templates"

export type Compressor = (input: {
  readonly model: Model
  readonly prompt: string
  readonly maxTokens: number
}) => Effect.Effect<string, unknown>

export const lineCount = (text: string): number => text.split("\n").length

const tailOf = (text: string, lines: number): string => text.split("\n").slice(-Math.max(1, lines)).join("\n")

export const assemble = (body: string, original: string, tailLines: number): string =>
  `${body}\n\n<verbatim-tail>\n${tailOf(original, tailLines)}\n</verbatim-tail>`

export type Input = {
  readonly toolName: string
  readonly output: string
  readonly settings: HybridSettings.Info
  readonly cheap?: Model
}

export const compress = (input: Input, compressor: Compressor): Effect.Effect<string> => {
  if (!input.settings.enabled || !input.cheap) return Effect.succeed(input.output)
  if (lineCount(input.output) <= input.settings.compressionThresholdLines) return Effect.succeed(input.output)

  const cheap = input.cheap
  const prompt = buildPrompt(selectTemplate(input.toolName, input.output), input.output)
  return Effect.gen(function* () {
    const body = yield* compressor({
      model: cheap,
      prompt,
      maxTokens: input.settings.compressionMaxTokens,
    })
    const trimmed = body.trim()
    if (trimmed.length === 0) return input.output
    return assemble(trimmed, input.output, input.settings.compressionTailLines)
  }).pipe(
    // Compress within a bounded timeout; on any failure (timeout, error, empty/invalid
    // result) silently fall back to the raw output. Compression must never corrupt,
    // truncate, or block the main path, so it always resolves to a usable string.
    Effect.timeoutOrElse({
      duration: Duration.millis(input.settings.compressionTimeoutMs),
      orElse: () => Effect.succeed(input.output),
    }),
    Effect.catch(() => Effect.succeed(input.output)),
    Effect.catchDefect(() => Effect.succeed(input.output)),
  )
}
