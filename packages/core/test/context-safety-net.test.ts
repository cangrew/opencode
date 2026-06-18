import { describe, expect, test } from "bun:test"
import * as fs from "node:fs/promises"
import * as path from "node:path"
import { DateTime, Effect, Stream } from "effect"
import { LLM, LLMEvent } from "@opencode-ai/llm"
import type { LLMRequest } from "@opencode-ai/llm"
import * as AnthropicMessages from "@opencode-ai/llm/protocols/anthropic-messages"
import { Auth } from "@opencode-ai/llm/route"
import { SessionCompaction } from "@opencode-ai/core/session/compaction"
import { SessionMessage } from "@opencode-ai/core/session/message"
import { SessionSchema } from "@opencode-ai/core/session/schema"
import { Token } from "@opencode-ai/core/util/token"

const ts = DateTime.makeUnsafe(0)
const sessionID = "session-test" as SessionSchema.ID

const makeModel = (contextWindow: number) =>
  AnthropicMessages.route
    .with({ auth: Auth.none, limits: { context: contextWindow, output: 1000 } })
    .model({ id: "test-model" })

const makeRequest = (contextWindow: number) =>
  LLM.request({
    model: makeModel(contextWindow),
    system: [],
    messages: [],
    tools: [],
  })

const makeUser = (text: string): SessionMessage.User =>
  new SessionMessage.User({
    id: SessionMessage.ID.create(),
    type: "user",
    text,
    time: { created: ts },
  })

const makeAssistantWithTool = (output: string): SessionMessage.Assistant => {
  const state = new SessionMessage.ToolStateCompleted({
    status: "completed",
    input: { cmd: "echo" },
    content: [{ type: "text" as const, text: output }],
    outputPaths: [],
    structured: {},
  })
  const tool = new SessionMessage.AssistantTool({
    type: "tool",
    id: `tool-${Math.random()}`,
    name: "bash",
    time: { created: ts },
    state,
  })
  return new SessionMessage.Assistant({
    id: SessionMessage.ID.create(),
    type: "assistant",
    agent: "main",
    model: { id: "test" as any, providerID: "anthropic" as any },
    time: { created: ts },
    content: [tool],
  })
}

const toEntries = (messages: SessionMessage.Message[]) =>
  messages.map((message, seq) => ({ seq, message }))

const makeMockEvents = () => {
  const published: Array<{ type: string; data: unknown }> = []
  const events = {
    publish: (definition: { type: string }, data: unknown) =>
      Effect.sync(() => {
        published.push({ type: definition.type, data })
        return { id: "evt-id", type: definition.type, data }
      }),
  } as any
  return { events, published }
}

const makeMockLLM = (summary: string | null) => ({
  stream: (_req: LLMRequest) =>
    Stream.fromIterable([LLMEvent.textDelta({ id: "b1", text: summary ?? "" })]),
})

const STARTED = "session.next.compaction.started"
const ENDED = "session.next.compaction.ended"

describe("Tier 1: applyToolResultBudget", () => {
  test("leaves messages unchanged when total chars are within budget", () => {
    const msg = makeAssistantWithTool("short output")
    const messages = [msg]
    const result = SessionCompaction.applyToolResultBudget(messages, 99999)
    expect(result).toBe(messages)
  })

  test("truncates oldest tool result first when total exceeds budget", () => {
    const old = makeAssistantWithTool("A".repeat(200))
    const newest = makeAssistantWithTool("B".repeat(200))
    const messages = [old, newest]
    const T = SessionCompaction.TRUNCATED_TOOL_RESULT.length
    const budget = T + 200 + 1

    const result = SessionCompaction.applyToolResultBudget(messages, budget)

    const oldPart = (result[0] as SessionMessage.Assistant).content[0] as SessionMessage.AssistantTool
    const newPart = (result[1] as SessionMessage.Assistant).content[0] as SessionMessage.AssistantTool
    expect(oldPart.state.status).toBe("completed")
    expect(newPart.state.status).toBe("completed")
    if (oldPart.state.status === "completed")
      expect(oldPart.state.content[0]).toMatchObject({ text: SessionCompaction.TRUNCATED_TOOL_RESULT })
    if (newPart.state.status === "completed")
      expect(newPart.state.content[0]).toMatchObject({ text: "B".repeat(200) })
  })

  test("truncates exactly enough oldest results to satisfy budget", () => {
    const L = 200
    const T = SessionCompaction.TRUNCATED_TOOL_RESULT.length
    const messages = [
      makeAssistantWithTool("A".repeat(L)),
      makeAssistantWithTool("B".repeat(L)),
      makeAssistantWithTool("C".repeat(L)),
    ]
    const budget = 2 * T + L + 1

    const result = SessionCompaction.applyToolResultBudget(messages, budget)

    let truncated = 0
    for (const msg of result) {
      if (msg.type !== "assistant") continue
      for (const part of msg.content) {
        if (part.type !== "tool" || part.state.status !== "completed") continue
        if (part.state.content[0]?.type === "text" && part.state.content[0].text === SessionCompaction.TRUNCATED_TOOL_RESULT)
          truncated++
      }
    }
    expect(truncated).toBe(2)
  })

  test("does not mutate the original messages array", () => {
    const output = "Y".repeat(1000)
    const msg = makeAssistantWithTool(output)
    const original = [msg]
    const result = SessionCompaction.applyToolResultBudget(original, 10)
    expect(result).not.toBe(original)
    const originalPart = (original[0] as SessionMessage.Assistant).content[0] as SessionMessage.AssistantTool
    if (originalPart.state.status === "completed")
      expect(originalPart.state.content[0]).toMatchObject({ text: output })
  })

  test("preserves non-assistant messages unchanged", () => {
    const user = makeUser("hello")
    const result = SessionCompaction.applyToolResultBudget([user], 1)
    expect(result[0]).toBe(user)
  })
})

describe("Tier 1: computeUtilization", () => {
  test("returns the ratio of estimated tokens to context window", () => {
    const request = makeRequest(10000)
    const utilization = SessionCompaction.computeUtilization(request, 10000)
    const body = JSON.stringify({ system: request.system, messages: request.messages, tools: request.tools })
    const expected = Token.estimate(body) / 10000
    expect(utilization).toBe(expected)
  })

  test("returns 0 when context window is 0", () => {
    expect(SessionCompaction.computeUtilization(makeRequest(0), 0)).toBe(0)
  })

  test("returns 0 when context window is negative", () => {
    expect(SessionCompaction.computeUtilization(makeRequest(1000), -1)).toBe(0)
  })

  test("returns a positive value for any non-trivial request", () => {
    const request = LLM.request({
      model: makeModel(100000),
      system: [{ type: "text", text: "You are a helpful assistant." }],
      messages: [],
      tools: [],
    })
    expect(SessionCompaction.computeUtilization(request, 100000)).toBeGreaterThan(0)
  })
})

describe("Tier 2: microCompactIfNeeded", () => {
  const makeCompaction = (summary: string | null) => {
    const { events, published } = makeMockEvents()
    const llm = makeMockLLM(summary)
    const compaction = SessionCompaction.make({ events, llm, config: [], collapseDir: "/tmp" })
    return { compaction, published }
  }

  test("returns false when entry count is at or below 10", async () => {
    const { compaction, published } = makeCompaction("summary")
    const model = makeModel(100000)
    const request = makeRequest(100000)
    const entries = toEntries(Array.from({ length: 10 }, () => makeUser("msg")))

    const result = await Effect.runPromise(
      compaction.microCompactIfNeeded({ sessionID, entries, model, request }),
    )

    expect(result).toBe(false)
    expect(published).toHaveLength(0)
  })

  test("returns false when LLM returns empty summary", async () => {
    const { compaction, published } = makeCompaction(null)
    const model = makeModel(100000)
    const request = makeRequest(100000)
    const entries = toEntries(Array.from({ length: 15 }, () => makeUser("msg")))

    const result = await Effect.runPromise(
      compaction.microCompactIfNeeded({ sessionID, entries, model, request }),
    )

    expect(result).toBe(false)
    expect(published.find((e) => e.type === STARTED)).toBeDefined()
    expect(published.find((e) => e.type === ENDED)).toBeUndefined()
  })

  test("returns true and emits Started then Ended when entry count exceeds 10", async () => {
    const { compaction, published } = makeCompaction("here is the summary")
    const model = makeModel(100000)
    const request = makeRequest(100000)
    const entries = toEntries(Array.from({ length: 15 }, () => makeUser("hello")))

    const result = await Effect.runPromise(
      compaction.microCompactIfNeeded({ sessionID, entries, model, request }),
    )

    expect(result).toBe(true)
    const startIdx = published.findIndex((e) => e.type === STARTED)
    const endIdx = published.findIndex((e) => e.type === ENDED)
    expect(startIdx).toBeGreaterThanOrEqual(0)
    expect(endIdx).toBeGreaterThan(startIdx)
    expect((published[endIdx]?.data as any)?.text).toBe("here is the summary")
  })

  test("keeps the 10 most recent messages in the 'recent' field", async () => {
    const messages = Array.from({ length: 15 }, (_, i) => makeUser(`message-${i}`))
    const { compaction, published } = makeCompaction("summary")
    const model = makeModel(100000)
    const request = makeRequest(100000)

    await Effect.runPromise(
      compaction.microCompactIfNeeded({ sessionID, entries: toEntries(messages), model, request }),
    )

    const ended = published.find((e) => e.type === ENDED)
    const recent: string = (ended?.data as any)?.recent ?? ""
    expect(recent).toContain("message-14")
    expect(recent).toContain("message-5")
    expect(recent).not.toContain("message-4")
  })

  test("uses cheapModel for summarization when provided", async () => {
    let capturedModelId: string | undefined
    const { events } = makeMockEvents()
    const llm = {
      stream: (req: LLMRequest) => {
        capturedModelId = req.model.id
        return Stream.fromIterable([LLMEvent.textDelta({ id: "b1", text: "summary" })])
      },
    }
    const compaction = SessionCompaction.make({ events, llm, config: [], collapseDir: "/tmp" })
    const model = makeModel(100000)
    const cheapModel = AnthropicMessages.route
      .with({ auth: Auth.none, limits: { context: 100000, output: 500 } })
      .model({ id: "cheap-model" })
    const request = makeRequest(100000)
    const entries = toEntries(Array.from({ length: 15 }, () => makeUser("hello")))

    await Effect.runPromise(
      compaction.microCompactIfNeeded({ sessionID, entries, model, request, cheapModel }),
    )

    expect(capturedModelId).toBe("cheap-model")
  })

  test("falls back to session model when cheapModel is not provided", async () => {
    let capturedModelId: string | undefined
    const { events } = makeMockEvents()
    const llm = {
      stream: (req: LLMRequest) => {
        capturedModelId = req.model.id
        return Stream.fromIterable([LLMEvent.textDelta({ id: "b1", text: "summary" })])
      },
    }
    const compaction = SessionCompaction.make({ events, llm, config: [], collapseDir: "/tmp" })
    const model = makeModel(100000)
    const request = makeRequest(100000)
    const entries = toEntries(Array.from({ length: 15 }, () => makeUser("hello")))

    await Effect.runPromise(
      compaction.microCompactIfNeeded({ sessionID, entries, model, request }),
    )

    expect(capturedModelId).toBe("test-model")
  })
})

describe("Tier 3: collapseIfNeeded", () => {
  const makeCollapse = (summary: string | null) => {
    const { events, published } = makeMockEvents()
    const llm = makeMockLLM(summary)
    const collapseDir = `/tmp/opencode-collapse-test`
    const compaction = SessionCompaction.make({ events, llm, config: [], collapseDir })
    return { compaction, published }
  }

  test("returns false when there are no non-compaction entries", async () => {
    const { compaction, published } = makeCollapse("summary")
    const model = makeModel(100000)
    const request = makeRequest(100000)

    const result = await Effect.runPromise(
      compaction.collapseIfNeeded({ sessionID, entries: [], model, request }),
    )

    expect(result).toBe(false)
    expect(published).toHaveLength(0)
  })

  test("emits Ended with summary text and last user message on success", async () => {
    const { compaction, published } = makeCollapse("full collapse summary")
    const model = makeModel(100000)
    const request = makeRequest(100000)
    const messages = [makeUser("earlier message"), makeUser("last user message")]

    const result = await Effect.runPromise(
      compaction.collapseIfNeeded({ sessionID, entries: toEntries(messages), model, request }),
    )

    expect(result).toBe(true)
    const ended = published.find((e) => e.type === ENDED)
    expect(ended).toBeDefined()
    expect((ended?.data as any).text).toBe("full collapse summary")
    expect((ended?.data as any).recent).toContain("last user message")
  })

  test("on empty summary, emits Ended with empty text and last 4 messages", async () => {
    const { compaction, published } = makeCollapse(null)
    const model = makeModel(100000)
    const request = makeRequest(100000)
    const messages = Array.from({ length: 8 }, (_, i) => makeUser(`msg-${i}`))

    const result = await Effect.runPromise(
      compaction.collapseIfNeeded({ sessionID, entries: toEntries(messages), model, request }),
    )

    expect(result).toBe(true)
    const ended = published.find((e) => e.type === ENDED)
    expect((ended?.data as any).text).toBe("")
    const recent: string = (ended?.data as any).recent
    expect(recent).toContain("msg-7")
    expect(recent).toContain("msg-4")
    expect(recent).not.toContain("msg-3")
  })

  test("emits Started before Ended", async () => {
    const { compaction, published } = makeCollapse("ok")
    const model = makeModel(100000)
    const request = makeRequest(100000)

    await Effect.runPromise(
      compaction.collapseIfNeeded({ sessionID, entries: toEntries([makeUser("hello")]), model, request }),
    )

    const startIdx = published.findIndex((e) => e.type === STARTED)
    const endIdx = published.findIndex((e) => e.type === ENDED)
    expect(startIdx).toBeGreaterThanOrEqual(0)
    expect(endIdx).toBeGreaterThan(startIdx)
  })

  test("uses cheapModel for summarization when provided", async () => {
    let capturedModelId: string | undefined
    const { events } = makeMockEvents()
    const llm = {
      stream: (req: LLMRequest) => {
        capturedModelId = req.model.id
        return Stream.fromIterable([LLMEvent.textDelta({ id: "b1", text: "collapse summary" })])
      },
    }
    const compaction = SessionCompaction.make({ events, llm, config: [], collapseDir: "/tmp" })
    const model = makeModel(100000)
    const cheapModel = AnthropicMessages.route
      .with({ auth: Auth.none, limits: { context: 100000, output: 500 } })
      .model({ id: "cheap-collapse-model" })
    const request = makeRequest(100000)

    await Effect.runPromise(
      compaction.collapseIfNeeded({
        sessionID,
        entries: toEntries([makeUser("hello")]),
        model,
        request,
        cheapModel,
      }),
    )

    expect(capturedModelId).toBe("cheap-collapse-model")
  })

  test("writes backup JSON to collapseDir before collapsing", async () => {
    const collapseDir = `/tmp/opencode-collapse-backup-test-${Date.now()}`
    const { events, published: _published } = makeMockEvents()
    const llm = makeMockLLM("backup summary")
    const compaction = SessionCompaction.make({ events, llm, config: [], collapseDir })
    const model = makeModel(100000)
    const request = makeRequest(100000)
    const messages = [makeUser("first"), makeUser("second")]

    await Effect.runPromise(
      compaction.collapseIfNeeded({ sessionID, entries: toEntries(messages), model, request }),
    )

    const files = await fs.readdir(collapseDir)
    expect(files.length).toBeGreaterThan(0)
    const backupFile = files.find((f) => f.startsWith(sessionID) && f.endsWith(".json"))
    expect(backupFile).toBeDefined()
    const content = JSON.parse(await fs.readFile(path.join(collapseDir, backupFile!), "utf-8"))
    expect(Array.isArray(content)).toBe(true)
    expect(content).toHaveLength(messages.length)
    await fs.rm(collapseDir, { recursive: true, force: true })
  })
})
