import { expect, test } from "bun:test"
import { LLM, LLMEvent, Model, type LLMRequest } from "@opencode-ai/llm"
import { route } from "@opencode-ai/llm/protocols/openai-chat"
import { DateTime, Effect, Stream } from "effect"
import type { EventV2 } from "@opencode-ai/core/event"
import { SessionCompaction } from "@opencode-ai/core/session/compaction"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionSchema } from "@opencode-ai/core/session/schema"

test("compaction describes tool media without embedding base64", () => {
  const base64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB"
  const serialized = SessionCompaction.serializeToolContent([
    { type: "text", text: "Image read successfully" },
    {
      type: "file",
      uri: `data:image/png;base64,${base64}`,
      mime: "image/png",
      name: "pixel.png",
    },
  ])

  expect(serialized).toBe("Image read successfully\n[Attached image/png: pixel.png]")
  expect(serialized).not.toContain(base64)
})

test("compaction caps summary output to routed cheap model limits", async () => {
  const requests: LLMRequest[] = []
  const compaction = SessionCompaction.make({
    events,
    config: config(),
    hybrid: { settings: settings(), resolveCheap: () => Effect.succeed(model("cheap", 10_000, 128)) },
    llm: {
      stream: (request) => {
        requests.push(request)
        return Stream.fromIterable([LLMEvent.textDelta({ id: "summary", text: "summary" })])
      },
    },
  })

  await Effect.runPromise(compaction.compactAfterOverflow(input()))

  expect(String(requests[0]?.model.id)).toBe("cheap")
  expect(requests[0]?.generation?.maxTokens).toBe(128)
})

test("compaction falls back to main model when cheap context is too small", async () => {
  const requests: LLMRequest[] = []
  const compaction = SessionCompaction.make({
    events,
    config: config(),
    hybrid: { settings: settings(), resolveCheap: () => Effect.succeed(model("cheap", 10, 128)) },
    llm: {
      stream: (request) => {
        requests.push(request)
        return Stream.fromIterable([LLMEvent.textDelta({ id: "summary", text: "summary" })])
      },
    },
  })

  await Effect.runPromise(compaction.compactAfterOverflow(input()))

  expect(String(requests[0]?.model.id)).toBe("main")
})

const model = (id: string, context: number, output: number) =>
  Model.make({ provider: "test", id, route: route.with({ limits: { context, output } }) })

const events = {
  publish: ((_event, payload) => Effect.succeed(payload)) as EventV2.Interface["publish"],
} as EventV2.Interface

const settings = () => ({
  enabled: true,
  compressionThresholdLines: 40,
  compressionTimeoutMs: 5_000,
  compressionMaxTokens: 1_024,
  compressionTailLines: 3,
  logRouting: false,
})

const config = () =>
  [
    {
      type: "document",
      info: { compaction: { keep: { tokens: 10 } } },
    },
  ] as const

const input = () => {
  const main = model("main", 10_000, 8_192)
  return {
    sessionID: SessionSchema.ID.create(),
    entries: [
      {
        seq: 1,
        message: new SessionMessage.User({
          id: SessionMessage.ID.create(),
          type: "user",
          text: "Please summarize this conversation. ".repeat(200),
          files: [],
          agents: [],
          time: { created: DateTime.makeUnsafe(0) },
        }),
      },
    ],
    model: main,
    request: LLM.request({ model: main, messages: [], tools: [], generation: { maxTokens: 8_192 } }),
  }
}
