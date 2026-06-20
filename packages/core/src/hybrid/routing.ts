export * as HybridRouting from "./routing"

import type { Model } from "@opencode-ai/llm"
import type { HybridSettings } from "./settings"

export const LIGHTWEIGHT_TASK_TYPES = ["title", "compaction", "complete", "webfetch", "websearch"] as const

export type LightweightTaskType = (typeof LIGHTWEIGHT_TASK_TYPES)[number]

export type TaskType = LightweightTaskType | "primary"

export type RouteTarget = "cheap" | "main"

export const isLightweight = (taskType: TaskType): taskType is LightweightTaskType =>
  (LIGHTWEIGHT_TASK_TYPES as readonly string[]).includes(taskType)

export const routeTarget = (
  taskType: TaskType,
  settings: Pick<HybridSettings.Info, "enabled">,
  cheapAvailable: boolean,
): RouteTarget => (settings.enabled && cheapAvailable && isLightweight(taskType) ? "cheap" : "main")

export const resolveModel = (
  taskType: TaskType,
  input: {
    readonly main: Model
    readonly cheap?: Model
    readonly settings: Pick<HybridSettings.Info, "enabled">
  },
): Model =>
  routeTarget(taskType, input.settings, input.cheap !== undefined) === "cheap" && input.cheap
    ? input.cheap
    : input.main

export const describe = (taskType: TaskType, target: RouteTarget, model: Model): string =>
  `hybrid routing: task=${taskType} -> ${target} (${model.provider}/${model.id})`
