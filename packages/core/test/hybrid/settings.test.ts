import { describe, expect, test } from "bun:test"
import { Config } from "@opencode-ai/core/config"
import { ConfigHybrid } from "@opencode-ai/core/config/hybrid"
import { HybridSettings } from "@opencode-ai/core/hybrid/settings"

const doc = (hybrid: ConfigHybrid.Info) => new Config.Document({ type: "document", info: new Config.Info({ hybrid }) })

describe("HybridSettings.resolve", () => {
  test("returns defaults when no document configures hybrid", () => {
    expect(HybridSettings.resolve([])).toEqual(HybridSettings.DEFAULTS)
  })

  test("maps snake_case config keys to the resolved settings", () => {
    const resolved = HybridSettings.resolve([
      doc(
        new ConfigHybrid.Info({
          enabled: true,
          cheap_model: new ConfigHybrid.CheapModel({ providerID: "anthropic", modelID: "haiku" }),
          compression_threshold_lines: 80,
          compression_timeout_ms: 1234,
          compression_max_tokens: 256,
          compression_tail_lines: 5,
          log_routing: true,
        }),
      ),
    ])
    expect(resolved).toEqual({
      enabled: true,
      cheapModel: { providerID: "anthropic", modelID: "haiku" },
      compressionThresholdLines: 80,
      compressionTimeoutMs: 1234,
      compressionMaxTokens: 256,
      compressionTailLines: 5,
      logRouting: true,
    })
  })

  test("later documents win per field", () => {
    const resolved = HybridSettings.resolve([
      doc(new ConfigHybrid.Info({ enabled: true, cheap_model: new ConfigHybrid.CheapModel({ providerID: "a", modelID: "1" }) })),
      doc(new ConfigHybrid.Info({ enabled: false })),
    ])
    expect(resolved.enabled).toBe(false)
    expect(resolved.cheapModel).toEqual({ providerID: "a", modelID: "1" })
  })
})
