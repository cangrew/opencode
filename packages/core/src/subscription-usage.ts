export * as SubscriptionUsage from "./subscription-usage"

import { and, asc, eq } from "drizzle-orm"
import type { ProviderMetadata } from "@opencode-ai/llm"
import { Context, DateTime, Effect, Layer, Schema } from "effect"
import { Database } from "./database/database"
import { EventV2 } from "./event"
import { ProviderV2 } from "./provider"
import { SubscriptionUsageTable } from "./subscription-usage/sql"
import { V2Schema } from "./v2-schema"

export const AccountID = Schema.String.pipe(Schema.brand("SubscriptionUsage.AccountID"))
export type AccountID = typeof AccountID.Type

export class Window extends Schema.Class<Window>("SubscriptionUsage.Window")({
  usedPercent: Schema.Number,
  windowMinutes: Schema.Number,
  resetsAt: V2Schema.DateTimeUtcFromMillis,
}) {}

export class Info extends Schema.Class<Info>("SubscriptionUsage.Info")({
  provider: ProviderV2.ID,
  accountID: AccountID,
  primary: Window.pipe(Schema.optional),
  secondary: Window.pipe(Schema.optional),
  capturedAt: V2Schema.DateTimeUtcFromMillis,
}) {}

export const Event = {
  Updated: EventV2.define({
    type: "subscription-usage.updated",
    schema: {
      usage: Info,
    },
  }),
}

export interface Interface {
  readonly get: (input: { provider: ProviderV2.ID; accountID: AccountID }) => Effect.Effect<Info | undefined>
  readonly list: () => Effect.Effect<Info[]>
  readonly upsertLatest: (input: Info) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SubscriptionUsage") {}

const record = (value: unknown): Record<string, unknown> | undefined =>
  typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined

const toDateTime = (value: string) => DateTime.makeUnsafe(new Date(value).getTime())

const fromRow = (row: typeof SubscriptionUsageTable.$inferSelect) =>
  new Info({
    provider: row.provider,
    accountID: row.account_id,
    ...(row.primary_window ? { primary: new Window({ ...row.primary_window, resetsAt: toDateTime(row.primary_window.resetsAt) }) } : {}),
    ...(row.secondary_window
      ? { secondary: new Window({ ...row.secondary_window, resetsAt: toDateTime(row.secondary_window.resetsAt) }) }
      : {}),
    capturedAt: DateTime.makeUnsafe(row.captured_at),
  })

const storedWindow = (value: Window | undefined) =>
  value
    ? {
        usedPercent: value.usedPercent,
        windowMinutes: value.windowMinutes,
        resetsAt: new Date(DateTime.toEpochMillis(value.resetsAt)).toISOString(),
      }
    : null

const sameWindow = (left: Window | undefined, right: Window | undefined) =>
  left?.usedPercent === right?.usedPercent &&
  left?.windowMinutes === right?.windowMinutes &&
  (left?.resetsAt === undefined ? undefined : DateTime.toEpochMillis(left.resetsAt)) ===
    (right?.resetsAt === undefined ? undefined : DateTime.toEpochMillis(right.resetsAt))

const sameSnapshot = (left: Info | undefined, right: Info) =>
  left?.provider === right.provider &&
  left?.accountID === right.accountID &&
  sameWindow(left?.primary, right.primary) &&
  sameWindow(left?.secondary, right.secondary)

const providerRecord = (metadata: ProviderMetadata | undefined, provider: ProviderV2.ID) => record(metadata?.[provider])

const window = (value: unknown) => {
  const item = record(value)
  if (!item) return
  if (typeof item.usedPercent !== "number" || typeof item.windowMinutes !== "number" || typeof item.resetsAt !== "string")
    return
  const resetsAt = new Date(item.resetsAt)
  if (Number.isNaN(resetsAt.getTime())) return
  return new Window({ usedPercent: item.usedPercent, windowMinutes: item.windowMinutes, resetsAt: DateTime.makeUnsafe(resetsAt.getTime()) })
}

export const requestAccountID = (input: { body?: unknown; headers?: Record<string, string> }) => {
  const body = record(input.body)
  const accountID = body?.accountID ?? body?.accountId ?? input.headers?.["ChatGPT-Account-Id"]
  if (typeof accountID !== "string" || accountID.length === 0) return
  return AccountID.make(accountID)
}

export const fromProviderMetadata = (input: {
  provider: ProviderV2.ID
  accountID: AccountID
  providerMetadata?: ProviderMetadata
  capturedAt?: DateTime.Utc
}) => {
  const provider = providerRecord(input.providerMetadata, input.provider)
  const subscriptionUsage = record(provider?.subscriptionUsage)
  if (!subscriptionUsage) return
  const primary = window(subscriptionUsage.primary)
  const secondary = window(subscriptionUsage.secondary)
  if (primary === undefined && secondary === undefined) return
  return new Info({
    provider: input.provider,
    accountID: input.accountID,
    ...(primary ? { primary } : {}),
    ...(secondary ? { secondary } : {}),
    capturedAt: input.capturedAt ?? DateTime.makeUnsafe(Date.now()),
  })
}

export const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const { db } = yield* Database.Service
    const events = yield* EventV2.Service
    return Service.of({
      get: Effect.fn("SubscriptionUsage.get")(function* (input) {
        const row = yield* db
          .select()
          .from(SubscriptionUsageTable)
          .where(and(eq(SubscriptionUsageTable.provider, input.provider), eq(SubscriptionUsageTable.account_id, input.accountID)))
          .get()
          .pipe(Effect.orDie)
        return row ? fromRow(row) : undefined
      }),
      list: Effect.fn("SubscriptionUsage.list")(function* () {
        return (yield* db
          .select()
          .from(SubscriptionUsageTable)
          .orderBy(asc(SubscriptionUsageTable.provider), asc(SubscriptionUsageTable.account_id))
          .all()
          .pipe(Effect.orDie)).map(fromRow)
      }),
      upsertLatest: Effect.fn("SubscriptionUsage.upsertLatest")(function* (input) {
        const previous = yield* db
          .select()
          .from(SubscriptionUsageTable)
          .where(and(eq(SubscriptionUsageTable.provider, input.provider), eq(SubscriptionUsageTable.account_id, input.accountID)))
          .get()
          .pipe(Effect.orDie)
        const existing = previous ? fromRow(previous) : undefined
        if (existing && DateTime.toEpochMillis(existing.capturedAt) > DateTime.toEpochMillis(input.capturedAt)) return
        const next = {
          provider: input.provider,
          account_id: input.accountID,
          primary_window: storedWindow(input.primary),
          secondary_window: storedWindow(input.secondary),
          captured_at: DateTime.toEpochMillis(input.capturedAt),
        }
        yield* db
          .insert(SubscriptionUsageTable)
          .values(next)
          .onConflictDoUpdate({
            target: [SubscriptionUsageTable.provider, SubscriptionUsageTable.account_id],
            set: next,
          })
          .run()
          .pipe(Effect.orDie)
        if (sameSnapshot(existing, input)) return
        yield* events.publish(Event.Updated, { usage: input })
      }),
    })
  }),
)

export const defaultLayer = layer.pipe(Layer.provide(EventV2.defaultLayer), Layer.provide(Database.defaultLayer))
