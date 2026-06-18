export * as SessionCompaction from "./compaction"

import path from "path"
import fs from "fs/promises"
import { LLM, LLMError, LLMEvent, Message, type LLMRequest, type Model } from "@opencode-ai/llm"
import { DateTime, Effect, Stream } from "effect"
import type { Config } from "../config"
import type { EventV2 } from "../event"
import { SessionEvent } from "./event"
import { SessionMessage } from "./message"
import { SessionSchema } from "./schema"
import { Token } from "../util/token"

const DEFAULT_BUFFER = 20_000
const DEFAULT_KEEP_TOKENS = 8_000
const TOOL_OUTPUT_MAX_CHARS = 2_000
const SUMMARY_OUTPUT_TOKENS = 4_096
const MICROCOMPACT_KEEP_COUNT = 10
const COLLAPSE_KEEP_COUNT = 4
export const TRUNCATED_TOOL_RESULT = "[tool result truncated to save context]"
const SUMMARY_TEMPLATE = `Output exactly the Markdown structure shown inside <template> and keep the section order unchanged. Do not include the <template> tags in your response.
<template>
## Goal
- [single-sentence task summary]

## Constraints & Preferences
- [user constraints, preferences, specs, or "(none)"]

## Progress
### Done
- [completed work or "(none)"]

### In Progress
- [current work or "(none)"]

### Blocked
- [blockers or "(none)"]

## Key Decisions
- [decision and why, or "(none)"]

## Next Steps
- [ordered next actions or "(none)"]

## Critical Context
- [important technical facts, errors, open questions, or "(none)"]

## Relevant Files
- [file or directory path: why it matters, or "(none)"]
</template>

Rules:
- Keep every section, even when empty.
- Use terse bullets, not prose paragraphs.
- Preserve exact file paths, commands, error strings, and identifiers when known.
- Do not mention the summary process or that context was compacted.`

type Entry = {
  readonly seq: number
  readonly message: SessionMessage.Message
}

type Settings = {
  readonly auto: boolean
  readonly buffer: number
  readonly tokens: number
}

type Dependencies = {
  readonly events: EventV2.Interface
  readonly llm: {
    readonly stream: (request: LLMRequest) => Stream.Stream<LLMEvent, LLMError>
  }
  readonly config: readonly Config.Entry[]
  readonly collapseDir: string
}

type Input = {
  readonly sessionID: SessionSchema.ID
  readonly entries: readonly Entry[]
  readonly model: Model
  readonly request: LLMRequest
  readonly cheapModel?: Model
}

const estimate = (value: unknown) => Token.estimate(JSON.stringify(value))

const truncate = (value: string) =>
  value.length <= TOOL_OUTPUT_MAX_CHARS ? value : `${value.slice(0, TOOL_OUTPUT_MAX_CHARS)}\n[truncated]`

export const serializeToolContent = (content: SessionMessage.ToolStateCompleted["content"]) =>
  content
    .map((item) =>
      item.type === "text" ? item.text : `[Attached ${item.mime}${item.name === undefined ? "" : `: ${item.name}`}]`,
    )
    .join("\n")

const serialize = (message: SessionMessage.Message) => {
  if (message.type === "user") {
    const files = message.files?.map((file) => `[Attached ${file.mime}: ${file.name ?? file.uri}]`) ?? []
    return [`[User]: ${message.text}`, ...files].join("\n")
  }
  if (message.type === "assistant") {
    return message.content
      .flatMap((part) => {
        if (part.type === "text") return [`[Assistant]: ${part.text}`]
        if (part.type === "reasoning") return part.text ? [`[Assistant reasoning]: ${part.text}`] : []
        const input = typeof part.state.input === "string" ? part.state.input : JSON.stringify(part.state.input)
        if (part.state.status === "completed")
          return [
            `[Assistant tool call]: ${part.name}(${input})`,
            `[Tool result]: ${truncate(serializeToolContent(part.state.content))}`,
          ]
        if (part.state.status === "error")
          return [`[Assistant tool call]: ${part.name}(${input})`, `[Tool error]: ${part.state.error.message}`]
        return [`[Assistant tool call]: ${part.name}(${input})`]
      })
      .join("\n")
  }
  if (message.type === "system") return `[System update]: ${message.text}`
  if (message.type === "synthetic") return `[Synthetic context]: ${message.text}`
  if (message.type === "shell") return `[Shell]: ${message.command}\n${truncate(message.output)}`
  return ""
}

const settings = (documents: readonly Config.Entry[]) => {
  const configured = documents
    .filter((entry): entry is Config.Document => entry.type === "document")
    .flatMap((entry) => (entry.info.compaction ? [entry.info.compaction] : []))
  return configured.reduce<Settings>(
    (result, current) => ({
      auto: current.auto ?? result.auto,
      buffer: current.buffer ?? result.buffer,
      tokens: current.keep?.tokens ?? result.tokens,
    }),
    { auto: true, buffer: DEFAULT_BUFFER, tokens: DEFAULT_KEEP_TOKENS },
  )
}

const select = (
  entries: readonly Entry[],
  tokens: number,
): { readonly head: string; readonly recent: string } | undefined => {
  const conversation = entries
    .filter((entry) => entry.message.type !== "compaction")
    .map((entry) => serialize(entry.message))
    .filter(Boolean)
  if (conversation.length === 0) return
  let total = 0
  let split = conversation.length
  let splitPrefix = ""
  let splitSuffix = ""
  for (let index = conversation.length - 1; index >= 0; index--) {
    const next = total + Token.estimate(conversation[index])
    if (next > tokens) {
      const remaining = Math.max(0, tokens - total) * 4
      if (remaining > 0) {
        splitPrefix = conversation[index].slice(0, -remaining)
        splitSuffix = conversation[index].slice(-remaining)
        split = index + 1
      }
      break
    }
    total = next
    split = index
  }
  return {
    head: [...conversation.slice(0, split), splitPrefix].filter(Boolean).join("\n\n"),
    recent: [splitSuffix, ...conversation.slice(split)].filter(Boolean).join("\n\n"),
  }
}

export const computeUtilization = (request: LLMRequest, contextWindow: number): number =>
  contextWindow > 0
    ? Token.estimate(JSON.stringify({ system: request.system, messages: request.messages, tools: request.tools })) /
      contextWindow
    : 0

export const applyToolResultBudget = (
  messages: readonly SessionMessage.Message[],
  budget: number,
): readonly SessionMessage.Message[] => {
  type ToolRef = { msgIdx: number; partIdx: number; chars: number }
  const toolRefs: ToolRef[] = []
  for (let msgIdx = 0; msgIdx < messages.length; msgIdx++) {
    const msg = messages[msgIdx]
    if (msg.type !== "assistant") continue
    for (let partIdx = 0; partIdx < msg.content.length; partIdx++) {
      const part = msg.content[partIdx]
      if (part.type !== "tool" || part.state.status !== "completed") continue
      toolRefs.push({ msgIdx, partIdx, chars: serializeToolContent(part.state.content).length })
    }
  }
  const total = toolRefs.reduce((sum, ref) => sum + ref.chars, 0)
  if (total <= budget) return messages
  const toTruncate = new Set<number>()
  let remaining = total
  const replacementChars = TRUNCATED_TOOL_RESULT.length
  for (let i = 0; i < toolRefs.length; i++) {
    if (remaining <= budget) break
    const saved = toolRefs[i].chars - replacementChars
    if (saved <= 0) continue
    remaining -= saved
    toTruncate.add(i)
  }
  let refIndex = 0
  return messages.map((msg) => {
    if (msg.type !== "assistant") return msg
    let modified = false
    const content = msg.content.map((part) => {
      if (part.type !== "tool" || part.state.status !== "completed") return part
      const i = refIndex++
      if (!toTruncate.has(i)) return part
      modified = true
      return new SessionMessage.AssistantTool({
        ...part,
        state: new SessionMessage.ToolStateCompleted({
          ...part.state,
          content: [{ type: "text" as const, text: TRUNCATED_TOOL_RESULT }],
          structured: {},
        }),
      })
    })
    if (!modified) return msg
    return new SessionMessage.Assistant({ ...msg, content })
  })
}

export const buildPrompt = (input: { readonly previousSummary?: string; readonly context: readonly string[] }) =>
  [
    input.previousSummary
      ? `Update the anchored summary below using the conversation history above.\nPreserve still-true details, remove stale details, and merge in the new facts.\n<previous-summary>\n${input.previousSummary}\n</previous-summary>`
      : "Create a new anchored summary from the conversation history.",
    SUMMARY_TEMPLATE,
    ...input.context,
  ].join("\n\n")

export const make = (dependencies: Dependencies) => {
  const config = settings(dependencies.config)
  const compactAfterOverflow = Effect.fn("SessionCompaction.compactAfterOverflow")(function* (input: Input) {
    const context = input.model.route.defaults.limits?.context
    if (context === undefined || context <= 0) return false
    const output = input.request.generation?.maxTokens ?? input.model.route.defaults.limits?.output ?? 0
    const selected = select(input.entries, config.tokens)
    const previousSummary = input.entries.find((entry) => entry.message.type === "compaction")?.message
    if (!selected || (selected.head.length === 0 && previousSummary?.type !== "compaction")) return false
    const summaryPrompt = buildPrompt({
      previousSummary: previousSummary?.type === "compaction" ? previousSummary.summary : undefined,
      context: [previousSummary?.type === "compaction" ? previousSummary.recent : "", selected.head].filter(Boolean),
    })
    const summaryOutput = Math.min(output || SUMMARY_OUTPUT_TOKENS, SUMMARY_OUTPUT_TOKENS)
    if (Token.estimate(summaryPrompt) > context - summaryOutput) return false
    const messageID = SessionMessage.ID.create()
    yield* dependencies.events.publish(SessionEvent.Compaction.Started, {
      sessionID: input.sessionID,
      messageID,
      timestamp: yield* DateTime.now,
      reason: "auto",
    })

    const chunks: string[] = []
    let failed = false
    const summarized = yield* dependencies.llm
      .stream(
        LLM.request({
          model: input.model,
          messages: [Message.user(summaryPrompt)],
          tools: [],
          generation: { maxTokens: summaryOutput },
        }),
      )
      .pipe(
        Stream.runForEach((event) => {
          if (LLMEvent.is.providerError(event)) failed = true
          if (LLMEvent.is.textDelta(event)) chunks.push(event.text)
          return Effect.void
        }),
        Effect.as(true),
        Effect.catchTag("LLM.Error", () => Effect.succeed(false)),
      )
    const summary = chunks.join("")
    if (!summarized || failed || !summary.trim()) return false
    yield* dependencies.events.publish(SessionEvent.Compaction.Ended, {
      sessionID: input.sessionID,
      messageID,
      timestamp: yield* DateTime.now,
      reason: "auto",
      text: summary,
      recent: selected.recent,
    })
    return true
  })
  const compactIfNeeded = Effect.fn("SessionCompaction.compactIfNeeded")(function* (input: Input) {
    if (!config.auto) return false
    const context = input.model.route.defaults.limits?.context
    if (context === undefined || context <= 0) return false
    const output = input.request.generation?.maxTokens ?? input.model.route.defaults.limits?.output ?? 0
    if (
      estimate({ system: input.request.system, messages: input.request.messages, tools: input.request.tools }) <=
      context - Math.max(output, config.buffer)
    )
      return false
    return yield* compactAfterOverflow(input)
  })
  const summarize = Effect.fn("SessionCompaction.summarize")(function* (
    model: Model,
    summaryPrompt: string,
    outputTokens: number,
  ) {
    const chunks: string[] = []
    let failed = false
    const ok = yield* dependencies.llm
      .stream(
        LLM.request({
          model,
          messages: [Message.user(summaryPrompt)],
          tools: [],
          generation: { maxTokens: outputTokens },
        }),
      )
      .pipe(
        Stream.runForEach((event) => {
          if (LLMEvent.is.providerError(event)) failed = true
          if (LLMEvent.is.textDelta(event)) chunks.push(event.text)
          return Effect.void
        }),
        Effect.as(true),
        Effect.catchTag("LLM.Error", () => Effect.succeed(false)),
      )
    const text = chunks.join("")
    return ok && !failed && text.trim() ? text : undefined
  })

  const microCompactIfNeeded = Effect.fn("SessionCompaction.microCompactIfNeeded")(function* (input: Input) {
    const context = input.model.route.defaults.limits?.context
    if (context === undefined || context <= 0) return false
    const conversation = input.entries
      .filter((entry) => entry.message.type !== "compaction")
      .map((entry) => serialize(entry.message))
      .filter(Boolean)
    if (conversation.length <= MICROCOMPACT_KEEP_COUNT) return false
    const split = conversation.length - MICROCOMPACT_KEEP_COUNT
    const head = conversation.slice(0, split).join("\n\n")
    const recent = conversation.slice(split).join("\n\n")
    const previousSummary = input.entries.find((e) => e.message.type === "compaction")?.message
    const summaryPrompt = buildPrompt({
      previousSummary: previousSummary?.type === "compaction" ? previousSummary.summary : undefined,
      context: [previousSummary?.type === "compaction" ? previousSummary.recent : "", head].filter(Boolean),
    })
    const output = input.request.generation?.maxTokens ?? input.model.route.defaults.limits?.output ?? 0
    const summaryOutput = Math.min(output || SUMMARY_OUTPUT_TOKENS, SUMMARY_OUTPUT_TOKENS)
    if (Token.estimate(summaryPrompt) > context - summaryOutput) return false
    const messageID = SessionMessage.ID.create()
    yield* dependencies.events.publish(SessionEvent.Compaction.Started, {
      sessionID: input.sessionID,
      messageID,
      timestamp: yield* DateTime.now,
      reason: "auto",
    })
    const summarizationModel = input.cheapModel ?? input.model
    const summary = yield* summarize(summarizationModel, summaryPrompt, summaryOutput)
    if (!summary) return false
    yield* dependencies.events.publish(SessionEvent.Compaction.Ended, {
      sessionID: input.sessionID,
      messageID,
      timestamp: yield* DateTime.now,
      reason: "auto",
      text: summary,
      recent,
    })
    return true
  })

  const collapseIfNeeded = Effect.fn("SessionCompaction.collapseIfNeeded")(function* (input: Input) {
    const context = input.model.route.defaults.limits?.context
    if (context === undefined || context <= 0) return false
    const conversation = input.entries
      .filter((entry) => entry.message.type !== "compaction")
      .map((entry) => serialize(entry.message))
      .filter(Boolean)
    if (conversation.length === 0) return false
    const messageID = SessionMessage.ID.create()
    const timestamp = yield* DateTime.now
    const backupPath = path.join(dependencies.collapseDir, `${input.sessionID}-${DateTime.toEpochMillis(timestamp)}.json`)
    const backedUp = yield* Effect.tryPromise(async () => {
      await fs.mkdir(dependencies.collapseDir, { recursive: true })
      await Bun.write(Bun.file(backupPath), JSON.stringify(input.entries.map((e) => e.message)))
      return true
    }).pipe(Effect.catch(() => Effect.succeed(false)))
    if (!backedUp) return false
    yield* dependencies.events.publish(SessionEvent.Compaction.Started, {
      sessionID: input.sessionID,
      messageID,
      timestamp,
      reason: "auto",
    })
    const summarizationModel = input.cheapModel ?? input.model
    const output = input.request.generation?.maxTokens ?? input.model.route.defaults.limits?.output ?? 0
    const summaryOutput = Math.min(output || SUMMARY_OUTPUT_TOKENS, SUMMARY_OUTPUT_TOKENS)
    const summaryPrompt = buildPrompt({ context: [conversation.join("\n\n")] })
    const summary = yield* summarize(summarizationModel, summaryPrompt, summaryOutput)
    const lastUserMessage = input.entries
      .filter((e) => e.message.type === "user")
      .at(-1)
    const lastUserText = lastUserMessage?.message.type === "user" ? serialize(lastUserMessage.message) : ""
    if (summary) {
      yield* dependencies.events.publish(SessionEvent.Compaction.Ended, {
        sessionID: input.sessionID,
        messageID,
        timestamp: yield* DateTime.now,
        reason: "auto",
        text: summary,
        recent: lastUserText,
      })
    } else {
      const keepLast = conversation.slice(-COLLAPSE_KEEP_COUNT).join("\n\n")
      yield* dependencies.events.publish(SessionEvent.Compaction.Ended, {
        sessionID: input.sessionID,
        messageID,
        timestamp: yield* DateTime.now,
        reason: "auto",
        text: "",
        recent: keepLast,
      })
    }
    return true
  })

  return {
    compactIfNeeded,
    compactAfterOverflow,
    microCompactIfNeeded,
    collapseIfNeeded,
  }
}
