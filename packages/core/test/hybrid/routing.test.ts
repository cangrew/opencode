import { describe, expect, test } from "bun:test"
import { Model } from "@opencode-ai/llm"
import { route } from "@opencode-ai/llm/protocols/openai-chat"
import { HybridRouting } from "@opencode-ai/core/hybrid/routing"
import { HybridSettings } from "@opencode-ai/core/hybrid/settings"

const main = Model.make({ provider: "anthropic", id: "main-model", route })
const cheap = Model.make({ provider: "anthropic", id: "cheap-model", route })

const settings = (over: Partial<HybridSettings.Info> = {}): HybridSettings.Info => ({ ...HybridSettings.DEFAULTS, ...over })

describe("HybridRouting.resolveModel", () => {
  test("routes each lightweight task type to the cheap model when active", () => {
    for (const taskType of HybridRouting.LIGHTWEIGHT_TASK_TYPES) {
      const model = HybridRouting.resolveModel(taskType, { main, cheap, settings: settings({ enabled: true }) })
      expect(model).toBe(cheap)
    }
  })

  test("uses the main model when hybrid is disabled", () => {
    const model = HybridRouting.resolveModel("compaction", { main, cheap, settings: settings({ enabled: false }) })
    expect(model).toBe(main)
  })

  test("uses the main model when no cheap model resolved", () => {
    const model = HybridRouting.resolveModel("compaction", { main, cheap: undefined, settings: settings({ enabled: true }) })
    expect(model).toBe(main)
  })

  test("primary turns always resolve to the main model, even when active", () => {
    const model = HybridRouting.resolveModel("primary", { main, cheap, settings: settings({ enabled: true }) })
    expect(model).toBe(main)
  })
})

describe("HybridRouting.routeTarget", () => {
  test("primary is never routed to cheap", () => {
    expect(HybridRouting.routeTarget("primary", { enabled: true }, true)).toBe("main")
  })

  test("lightweight routes to cheap only when enabled and a cheap model is available", () => {
    expect(HybridRouting.routeTarget("compaction", { enabled: true }, true)).toBe("cheap")
    expect(HybridRouting.routeTarget("compaction", { enabled: true }, false)).toBe("main")
    expect(HybridRouting.routeTarget("compaction", { enabled: false }, true)).toBe("main")
  })
})
