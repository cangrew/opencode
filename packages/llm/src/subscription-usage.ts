export * as SubscriptionUsage from "./subscription-usage"

import type { ProviderMetadata } from "./schema"

export type Window = {
  usedPercent: number
  windowMinutes: number
  resetsAt: string
}

export type Snapshot = {
  primary?: Window
  secondary?: Window
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

const number = (value: unknown) => {
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
}

const iso = (millis: number) => new Date(millis).toISOString()

const window = (input: { usedPercent: unknown; windowMinutes: unknown; resetAfterSeconds: unknown; now: number }) => {
  const usedPercent = number(input.usedPercent)
  const windowMinutes = number(input.windowMinutes)
  const resetAfterSeconds = number(input.resetAfterSeconds)
  if (usedPercent === undefined || windowMinutes === undefined || resetAfterSeconds === undefined) return
  return {
    usedPercent,
    windowMinutes,
    resetsAt: iso(input.now + resetAfterSeconds * 1000),
  } satisfies Window
}

export const fromHeaders = (headers: Record<string, string>, now = Date.now()) => {
  const primary = window({
    usedPercent: headers["x-codex-primary-used-percent"],
    windowMinutes: headers["x-codex-primary-window-minutes"],
    resetAfterSeconds: headers["x-codex-primary-reset-after-seconds"],
    now,
  })
  const secondary = window({
    usedPercent: headers["x-codex-secondary-used-percent"],
    windowMinutes: headers["x-codex-secondary-window-minutes"],
    resetAfterSeconds: headers["x-codex-secondary-reset-after-seconds"],
    now,
  })
  if (primary === undefined && secondary === undefined) return
  return { ...(primary === undefined ? {} : { primary }), ...(secondary === undefined ? {} : { secondary }) } satisfies Snapshot
}

const field = (source: Record<string, unknown> | undefined, keys: ReadonlyArray<string>) =>
  keys.map((key) => source?.[key]).find((value) => value !== undefined)

const fromRateLimitWindow = (input: Record<string, unknown> | undefined, now: number) =>
  window({
    usedPercent: field(input, ["used_percent", "usedPercent"]),
    windowMinutes: field(input, ["window_minutes", "windowMinutes"]),
    resetAfterSeconds: field(input, ["reset_after_seconds", "resetAfterSeconds"]),
    now,
  })

export const fromRateLimits = (value: unknown, now = Date.now()) => {
  const rateLimits = record(value)
  if (!rateLimits) return
  const primary = fromRateLimitWindow(record(rateLimits.primary), now)
  const secondary = fromRateLimitWindow(record(rateLimits.secondary), now)
  if (primary === undefined && secondary === undefined) return
  return { ...(primary === undefined ? {} : { primary }), ...(secondary === undefined ? {} : { secondary }) } satisfies Snapshot
}

export const merge = (...items: ReadonlyArray<Snapshot | undefined>) => {
  const snapshots = items.filter((item): item is Snapshot => item !== undefined)
  if (snapshots.length === 0) return
  return snapshots.reduce<Snapshot>(
    (result, item) => ({
      ...(result.primary === undefined && item.primary === undefined ? {} : { primary: item.primary ?? result.primary }),
      ...(result.secondary === undefined && item.secondary === undefined
        ? {}
        : { secondary: item.secondary ?? result.secondary }),
    }),
    {},
  )
}

export const providerMetadata = (input: {
  responseId?: string | null | undefined
  serviceTier?: string | null | undefined
  subscriptionUsage?: Snapshot | undefined
}) => {
  const metadata = {
    ...(input.responseId ? { responseId: input.responseId } : {}),
    ...(input.serviceTier ? { serviceTier: input.serviceTier } : {}),
    ...(input.subscriptionUsage ? { subscriptionUsage: input.subscriptionUsage } : {}),
  }
  if (Object.keys(metadata).length === 0) return
  return { openai: metadata } satisfies ProviderMetadata
}
