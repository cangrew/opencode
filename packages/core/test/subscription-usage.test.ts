import { describe, expect, test } from "bun:test"
import { DateTime, Effect, Layer } from "effect"
import { Database } from "@opencode-ai/core/database/database"
import { EventV2 } from "@opencode-ai/core/event"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { SubscriptionUsage } from "@opencode-ai/core/subscription-usage"
import { Stream } from "effect"
import { testEffect } from "./lib/effect"

const database = Database.layerFromPath(":memory:")
const events = EventV2.layer.pipe(Layer.provide(database))
const usage = SubscriptionUsage.layer.pipe(Layer.provide(events), Layer.provide(database))
const it = testEffect(Layer.mergeAll(database, events, usage))

const provider = ProviderV2.ID.openai
const accountID = SubscriptionUsage.AccountID.make("acct_1")

const snapshot = (input: { usedPercent: number; capturedAt: number }) =>
  new SubscriptionUsage.Info({
    provider,
    accountID,
    primary: new SubscriptionUsage.Window({
      usedPercent: input.usedPercent,
      windowMinutes: 300,
      resetsAt: DateTime.makeUnsafe(input.capturedAt + 1_000),
    }),
    capturedAt: DateTime.makeUnsafe(input.capturedAt),
  })

describe("SubscriptionUsage", () => {
  it.effect("replaces a snapshot with a newer lower-percent window reset", () =>
    Effect.gen(function* () {
      const service = yield* SubscriptionUsage.Service
      yield* service.upsertLatest(snapshot({ usedPercent: 90, capturedAt: 2_000 }))
      yield* service.upsertLatest(snapshot({ usedPercent: 10, capturedAt: 3_000 }))

      expect(yield* service.get({ provider, accountID })).toMatchObject({
        primary: { usedPercent: 10 },
        capturedAt: DateTime.makeUnsafe(3_000),
      })
    }),
  )

  it.effect("ignores stale older snapshots", () =>
    Effect.gen(function* () {
      const service = yield* SubscriptionUsage.Service
      yield* service.upsertLatest(snapshot({ usedPercent: 70, capturedAt: 5_000 }))
      yield* service.upsertLatest(snapshot({ usedPercent: 20, capturedAt: 4_000 }))

      expect(yield* service.get({ provider, accountID })).toMatchObject({
        primary: { usedPercent: 70 },
        capturedAt: DateTime.makeUnsafe(5_000),
      })
    }),
  )

})

test("SubscriptionUsage does not emit duplicate update events for unchanged snapshots", async () => {
  const published: string[] = []
  const eventLayer = Layer.succeed(
    EventV2.Service,
    EventV2.Service.of({
      publish: (definition, data) =>
        Effect.sync(() => {
          published.push(definition.type)
          return { id: EventV2.ID.create(), type: definition.type, data } as EventV2.Payload<typeof definition>
        }),
      subscribe: () => Stream.empty,
      all: () => Stream.empty,
      aggregateEvents: () => Stream.empty,
      sync: () => Effect.succeed(Effect.void),
      listen: () => Effect.succeed(Effect.void),
      beforeCommit: () => Effect.void,
      project: () => Effect.void,
      replay: () => Effect.void,
      replayAll: () => Effect.succeed(undefined),
      remove: () => Effect.void,
      claim: () => Effect.void,
    }),
  )
  const database = Database.layerFromPath(":memory:")

  await Effect.gen(function* () {
    const service = yield* SubscriptionUsage.Service
    const first = new SubscriptionUsage.Info({
      provider,
      accountID,
      primary: new SubscriptionUsage.Window({
        usedPercent: 40,
        windowMinutes: 300,
        resetsAt: DateTime.makeUnsafe(9_000),
      }),
      capturedAt: DateTime.makeUnsafe(6_000),
    })
    const second = new SubscriptionUsage.Info({
      ...first,
      capturedAt: DateTime.makeUnsafe(7_000),
    })
    yield* service.upsertLatest(first)
    yield* service.upsertLatest(second)
  })
    .pipe(Effect.provide(SubscriptionUsage.layer.pipe(Layer.provide(eventLayer), Layer.provide(database))))
    .pipe(Effect.runPromise)

  expect(published.filter((type) => type === SubscriptionUsage.Event.Updated.type)).toHaveLength(1)
})
