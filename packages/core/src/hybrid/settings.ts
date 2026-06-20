export * as HybridSettings from "./settings"

import type { Config } from "../config"

export const DEFAULT_THRESHOLD_LINES = 40
export const DEFAULT_TIMEOUT_MS = 5_000
export const DEFAULT_MAX_TOKENS = 1_024
export const DEFAULT_TAIL_LINES = 3

export type CheapModelRef = {
  readonly providerID: string
  readonly modelID: string
}

export type Info = {
  readonly enabled: boolean
  readonly cheapModel?: CheapModelRef
  readonly compressionThresholdLines: number
  readonly compressionTimeoutMs: number
  readonly compressionMaxTokens: number
  readonly compressionTailLines: number
  readonly logRouting: boolean
}

export const DEFAULTS: Info = {
  enabled: false,
  compressionThresholdLines: DEFAULT_THRESHOLD_LINES,
  compressionTimeoutMs: DEFAULT_TIMEOUT_MS,
  compressionMaxTokens: DEFAULT_MAX_TOKENS,
  compressionTailLines: DEFAULT_TAIL_LINES,
  logRouting: false,
}

export const resolve = (documents: readonly Config.Entry[]): Info => {
  const configured = documents
    .filter((entry): entry is Config.Document => entry.type === "document")
    .flatMap((entry) => (entry.info.hybrid ? [entry.info.hybrid] : []))
  return configured.reduce(
    (result, current) => ({
      enabled: current.enabled ?? result.enabled,
      cheapModel: current.cheap_model
        ? { providerID: current.cheap_model.providerID, modelID: current.cheap_model.modelID }
        : result.cheapModel,
      compressionThresholdLines: current.compression_threshold_lines ?? result.compressionThresholdLines,
      compressionTimeoutMs: current.compression_timeout_ms ?? result.compressionTimeoutMs,
      compressionMaxTokens: current.compression_max_tokens ?? result.compressionMaxTokens,
      compressionTailLines: current.compression_tail_lines ?? result.compressionTailLines,
      logRouting: current.log_routing ?? result.logRouting,
    }),
    DEFAULTS,
  )
}
