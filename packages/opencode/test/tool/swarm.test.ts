import { afterEach, describe, expect } from "bun:test"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { Database } from "@opencode-ai/core/database/database"
import { Cause, Effect, Exit, Layer } from "effect"
import { Agent } from "../../src/agent/agent"
import { BackgroundJob } from "@/background/job"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Config } from "@/config/config"
import { CrossSpawnSpawner } from "@opencode-ai/core/cross-spawn-spawner"
import { Ripgrep } from "@opencode-ai/core/ripgrep"
import { Session } from "@/session/session"
import type { SessionPrompt } from "../../src/session/prompt"
import { MessageID, PartID } from "../../src/session/schema"
import { SessionRunState } from "@/session/run-state"
import { SessionStatus } from "@/session/status"

import { SwarmTool } from "../../src/tool/swarm"
import type { TaskPromptOps } from "../../src/tool/task"
import { Truncate } from "@/tool/truncate"
import { ToolRegistry } from "@/tool/registry"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { disposeAllInstances } from "../fixture/fixture"
import { testEffect } from "../lib/effect"
import { ProviderV2 } from "@opencode-ai/core/provider"
import { ModelV2 } from "@opencode-ai/core/model"

afterEach(async () => {
  await disposeAllInstances()
})

const ref = {
  providerID: ProviderV2.ID.make("test"),
  modelID: ModelV2.ID.make("test-model"),
}

const layer = (flags: Partial<RuntimeFlags.Info> = {}) =>
  Layer.mergeAll(
    Agent.defaultLayer,
    BackgroundJob.defaultLayer,
    EventV2Bridge.defaultLayer,
    Config.defaultLayer,
    CrossSpawnSpawner.defaultLayer,
    Session.defaultLayer,
    SessionRunState.defaultLayer,
    SessionStatus.defaultLayer,
    Truncate.defaultLayer,
    ToolRegistry.defaultLayer,
    Database.defaultLayer,
    RuntimeFlags.layer(flags),
  ).pipe(Layer.provide(Ripgrep.defaultLayer))

const it = testEffect(layer())

const seed = Effect.fn("SwarmToolTest.seed")(function* (title = "Pinned") {
  const session = yield* Session.Service
  const chat = yield* session.create({ title })
  const user = yield* session.updateMessage({
    id: MessageID.ascending(),
    role: "user",
    sessionID: chat.id,
    agent: "build",
    model: ref,
    time: { created: Date.now() },
  })
  const assistant: SessionV1.Assistant = {
    id: MessageID.ascending(),
    role: "assistant",
    parentID: user.id,
    sessionID: chat.id,
    mode: "build",
    agent: "build",
    cost: 0,
    path: { cwd: "/tmp", root: "/tmp" },
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    modelID: ref.modelID,
    providerID: ref.providerID,
    variant: "xhigh",
    time: { created: Date.now() },
  }
  yield* session.updateMessage(assistant)
  return { chat, assistant }
})

function reply(input: SessionPrompt.PromptInput, text: string): SessionV1.WithParts {
  const id = MessageID.ascending()
  return {
    info: {
      id,
      role: "assistant",
      parentID: input.messageID ?? MessageID.ascending(),
      sessionID: input.sessionID,
      mode: input.agent ?? "general",
      agent: input.agent ?? "general",
      cost: 0,
      path: { cwd: "/tmp", root: "/tmp" },
      tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      modelID: input.model?.modelID ?? ref.modelID,
      providerID: input.model?.providerID ?? ref.providerID,
      time: { created: Date.now() },
      finish: "stop",
    },
    parts: [
      {
        id: PartID.ascending(),
        messageID: id,
        sessionID: input.sessionID,
        type: "text",
        text,
      },
    ],
  }
}

function stubOps(opts?: {
  onPrompt?: (input: SessionPrompt.PromptInput) => void
  text?: string | ((input: SessionPrompt.PromptInput) => string)
}): TaskPromptOps {
  return {
    cancel: () => Effect.void,
    resolvePromptParts: (template) => Effect.succeed([{ type: "text" as const, text: template }]),
    prompt: (input) =>
      Effect.sync(() => {
        opts?.onPrompt?.(input)
        const text =
          typeof opts?.text === "function" ? opts.text(input) : (opts?.text ?? "done")
        return reply(input, text)
      }),
  }
}

describe("tool.swarm", () => {
  it.instance("template expansion substitutes placeholders correctly", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* SwarmTool
      const def = yield* tool.init()
      const seen: SessionPrompt.PromptInput[] = []
      const promptOps = stubOps({ onPrompt: (input) => seen.push(input) })

      yield* def.execute(
        {
          template: "Review {{file}} for issues",
          items: [
            { id: "1", file: "foo.ts" },
            { id: "2", file: "bar.ts" },
          ],
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      expect(seen).toHaveLength(2)
      const texts = seen
        .map((s) => s.parts[0])
        .filter((p) => p?.type === "text")
        .map((p) => (p as any).text as string)
      expect(texts.some((t) => t.includes("foo.ts"))).toBe(true)
      expect(texts.some((t) => t.includes("bar.ts"))).toBe(true)
    }),
  )

  it.instance("missing placeholder causes item to error", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* SwarmTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        {
          template: "Review {{file}} for issues",
          items: [{ id: "1" }],
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps: stubOps() },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      expect(result.output).toContain('status="error"')
      expect(result.output).toContain("Missing placeholder")
    }),
  )

  it.instance("rejects items exceeding swarm_max_items", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* SwarmTool
      const def = yield* tool.init()
      const items = Array.from({ length: 21 }, (_, i) => ({ id: String(i) }))

      const exit = yield* def
        .execute(
          { template: "do {{id}}", items },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps: stubOps() },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause)
        expect(error instanceof Error && error.message).toContain("swarm_max_items")
      }
    }),
  )

  it.instance("rejects concurrency outside 1-20", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* SwarmTool
      const def = yield* tool.init()

      const exit = yield* def
        .execute(
          {
            template: "do {{id}}",
            items: [{ id: "1" }],
            concurrency: 25,
          },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps: stubOps() },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause)
        expect(error instanceof Error && error.message).toContain("concurrency must be between 1 and 20")
      }
    }),
  )

  it.instance("one item failing does not abort others", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* SwarmTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        {
          template: "Review {{file}}",
          items: [
            { id: "ok", file: "good.ts" },
            { id: "bad" },
          ],
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps: stubOps({ text: "ok result" }) },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      expect(result.output).toContain('id="ok" status="completed"')
      expect(result.output).toContain('id="bad" status="error"')
    }),
  )

  it.instance("XML aggregation has correct structure", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* SwarmTool
      const def = yield* tool.init()

      const result = yield* def.execute(
        {
          template: "Analyze {{topic}}",
          items: [
            { id: "alpha", topic: "cats" },
            { id: "beta", topic: "dogs" },
          ],
        },
        {
          sessionID: chat.id,
          messageID: assistant.id,
          agent: "build",
          abort: new AbortController().signal,
          extra: { promptOps: stubOps({ text: "analysis done" }) },
          messages: [],
          metadata: () => Effect.void,
          ask: () => Effect.void,
        },
      )

      expect(result.output).toContain("<swarm_results>")
      expect(result.output).toContain("</swarm_results>")
      expect(result.output).toContain('id="alpha"')
      expect(result.output).toContain('id="beta"')
      expect(result.output).toContain('status="completed"')
      expect(result.output).toContain("duration_ms=")
    }),
  )

  it.instance("rejects empty items array", () =>
    Effect.gen(function* () {
      const { chat, assistant } = yield* seed()
      const tool = yield* SwarmTool
      const def = yield* tool.init()

      const exit = yield* def
        .execute(
          { template: "do something", items: [] },
          {
            sessionID: chat.id,
            messageID: assistant.id,
            agent: "build",
            abort: new AbortController().signal,
            extra: { promptOps: stubOps() },
            messages: [],
            metadata: () => Effect.void,
            ask: () => Effect.void,
          },
        )
        .pipe(Effect.exit)

      expect(Exit.isFailure(exit)).toBe(true)
      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause)
        expect(error instanceof Error && error.message).toContain("items is required and must be non-empty")
      }
    }),
  )
})
