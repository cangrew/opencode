export * as SessionRunnerCost from "./cost"

import type { Usage } from "@opencode-ai/llm"
import { ModelV2 } from "../../model"

export type Tokens = {
  input: number
  output: number
  reasoning: number
  cache: {
    read: number
    write: number
  }
}

const safe = (value: number | undefined) => Math.max(0, Number.isFinite(value) ? (value ?? 0) : 0)

export const tokens = (usage: Usage | undefined): Tokens => {
  const reasoning = safe(usage?.reasoningTokens)
  const read = safe(usage?.cacheReadInputTokens)
  const write = safe(usage?.cacheWriteInputTokens)
  return {
    input: safe(usage?.nonCachedInputTokens),
    output: safe(usage?.visibleOutputTokens),
    reasoning,
    cache: { read, write },
  }
}

export const contextSize = (usage: Usage | undefined) => {
  const prompt = safe(usage?.inputTokens)
  if (prompt > 0) return prompt
  const normalized = tokens(usage)
  return normalized.input + normalized.cache.read + normalized.cache.write
}

export const computeCost = (modelCost: ModelV2.Info["cost"], usage: Tokens, size: number) => {
  const match = modelCost
    .filter((item) => item.tier === undefined || item.tier.size <= size)
    .sort((a, b) => (a.tier?.size ?? 0) - (b.tier?.size ?? 0))
    .at(-1)
  if (!match) return 0
  return (
    usage.input * match.input +
    (usage.output + usage.reasoning) * match.output +
    usage.cache.read * match.cache.read +
    usage.cache.write * match.cache.write
  ) / 1_000_000
}
