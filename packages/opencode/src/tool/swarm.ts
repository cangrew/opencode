import * as Tool from "./tool"
import DESCRIPTION from "./swarm.txt"
import { SessionV1 } from "@opencode-ai/core/v1/session"
import { BackgroundJob } from "@/background/job"
import { Session } from "@/session/session"
import { MessageID } from "../session/schema"
import { MessageV2 } from "../session/message-v2"
import { Agent } from "../agent/agent"
import { deriveSubagentSessionPermission } from "../agent/subagent-permissions"
import type { TaskPromptOps } from "./task"
import { Config } from "@/config/config"
import { Duration, Effect, Exit, Schema, Scope, Semaphore } from "effect"
import { EffectBridge } from "@/effect/bridge"
import { Database } from "@opencode-ai/core/database/database"

const id = "swarm"

const BACKGROUND_STARTED = [
  "The swarm is working in the background. You will be notified automatically when all items finish.",
  "DO NOT sleep, poll for progress, or duplicate this swarm's work.",
  "Work on non-overlapping tasks, or briefly tell the user what you launched and end your response.",
].join("\n")

const BACKGROUND_UPDATED = [
  "Additional context sent to the running background swarm.",
  "The swarm is still working in the background. You will be notified automatically when it finishes.",
  "DO NOT sleep, poll for progress, or duplicate this swarm's work.",
  "Work on non-overlapping tasks, or briefly tell the user what you sent and end your response.",
].join("\n")

const ItemSchema = Schema.Record(Schema.String, Schema.String)

export const Parameters = Schema.Struct({
  template: Schema.String.annotate({ description: "Prompt template with {{placeholder}} markers" }),
  items: Schema.Array(ItemSchema).annotate({
    description: 'Array of objects with a required non-empty "id" field and placeholder values',
  }),
  agent: Schema.optional(Schema.String).annotate({ description: "Agent type to use for each item (default: general)" }),
  concurrency: Schema.optional(Schema.Number).annotate({
    description: "Max parallel subagents, 1-20 (default: 5)",
  }),
  background: Schema.optional(Schema.Boolean).annotate({
    description: "Run asynchronously and inject result when done",
  }),
})

type ItemResult = {
  id: string
  status: "completed" | "error"
  duration_ms: number
  text: string
}

function escapeXml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
}

function expandTemplate(template: string, item: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, key) => {
    if (!(key in item)) throw new Error(`Missing placeholder: ${key}`)
    return item[key]
  })
}

function renderSwarmResults(results: ItemResult[]): string {
  const items = results
    .map(
      (r) =>
        `<item id="${escapeXml(r.id)}" status="${r.status}" duration_ms="${r.duration_ms}">${escapeXml(r.text)}</item>`,
    )
    .join("\n")
  return `<swarm_results>\n${items}\n</swarm_results>`
}

export const SwarmTool = Tool.define(
  id,
  Effect.gen(function* () {
    const agent = yield* Agent.Service
    const background = yield* BackgroundJob.Service
    const config = yield* Config.Service
    const sessions = yield* Session.Service
    const scope = yield* Scope.Scope
    const database = yield* Database.Service

    const run = Effect.fn("SwarmTool.execute")(function* (
      params: Schema.Schema.Type<typeof Parameters>,
      ctx: Tool.Context,
    ) {
      const cfg = yield* config.get()
      const maxItems = cfg.experimental?.swarm_max_items ?? 20
      const defaultConcurrency = cfg.experimental?.swarm_concurrency ?? 5
      const itemTimeoutMs = cfg.experimental?.swarm_item_timeout_ms ?? 600_000

      const resolvedConcurrency = Math.min(20, Math.max(1, params.concurrency ?? defaultConcurrency))
      const runInBackground = params.background === true
      const agentName = params.agent ?? "general"

      if (!params.template) {
        return yield* Effect.fail(new Error("template is required"))
      }
      if (!params.items || params.items.length === 0) {
        return yield* Effect.fail(new Error("items is required and must be non-empty"))
      }
      if (params.concurrency !== undefined && (params.concurrency < 1 || params.concurrency > 20)) {
        return yield* Effect.fail(new Error("concurrency must be between 1 and 20"))
      }
      if (params.items.length > maxItems) {
        return yield* Effect.fail(
          new Error(`items length ${params.items.length} exceeds swarm_max_items limit of ${maxItems}`),
        )
      }
      const missingId = params.items.findIndex((item) => !item["id"])
      if (missingId >= 0) {
        return yield* Effect.fail(new Error(`item at index ${missingId} is missing a required non-empty "id" field`))
      }

      const next = yield* agent.get(agentName)
      if (!next) {
        return yield* Effect.fail(new Error(`Unknown agent type: ${agentName} is not a valid agent type`))
      }

      const parent = yield* sessions.get(ctx.sessionID)
      const childPermission = deriveSubagentSessionPermission({
        parentSessionPermission: parent.permission ?? [],
        subagent: next,
      })

      const msg = yield* MessageV2.get({ sessionID: ctx.sessionID, messageID: ctx.messageID }).pipe(
        Effect.provideService(Database.Service, database),
        Effect.orDie,
      )
      if (msg.info.role !== "assistant") return yield* Effect.fail(new Error("Not an assistant message"))
      const variant = msg.info.variant

      const model = next.model ?? {
        modelID: msg.info.modelID,
        providerID: msg.info.providerID,
      }

      const ops = ctx.extra?.promptOps as TaskPromptOps
      if (!ops) return yield* Effect.fail(new Error("SwarmTool requires promptOps in ctx.extra"))

      const coordinatorSession = yield* sessions.create({
        parentID: ctx.sessionID,
        title: `swarm(${params.items.length} items) coordinator`,
        agent: next.name,
        permission: [],
      })

      const metadata = {
        parentSessionId: ctx.sessionID,
        sessionId: coordinatorSession.id,
        model,
        ...(runInBackground ? { background: true } : {}),
      }

      yield* ctx.metadata({ title: `swarm(${params.items.length} items)`, metadata })

      const childToolDenies = [
        { permission: "task" as const, pattern: "*" as const, action: "deny" as const },
        { permission: "swarm" as const, pattern: "*" as const, action: "deny" as const },
        ...(next.permission.some((rule) => rule.permission === "todowrite")
          ? []
          : [{ permission: "todowrite" as const, pattern: "*" as const, action: "deny" as const }]),
      ]

      const runSwarm = Effect.fn("SwarmTool.runSwarm")(function* () {
        const semaphore = yield* Semaphore.make(resolvedConcurrency)

        const runItem = (item: Record<string, string>): Effect.Effect<ItemResult> =>
          Effect.gen(function* () {
            const itemId = item["id"]!
            const start = Date.now()

            const expanded = yield* Effect.try({
              try: () => expandTemplate(params.template, item),
              catch: (err) => (err instanceof Error ? err : new Error(String(err))),
            })

            const childSession = yield* sessions.create({
              parentID: ctx.sessionID,
              title: `swarm item ${itemId} (@${next.name})`,
              agent: next.name,
              permission: [
                ...childPermission,
                ...childToolDenies.filter(
                  (deny) =>
                    !childPermission.some(
                      (rule) =>
                        rule.permission === deny.permission &&
                        rule.pattern === deny.pattern &&
                        rule.action === deny.action,
                    ),
                ),
              ],
            })

            const result: ItemResult = yield* semaphore.withPermits(1)(
              Effect.gen(function* () {
                const itemStart = Date.now()
                const parts = yield* ops.resolvePromptParts(expanded)
                const res = yield* ops.prompt({
                  messageID: MessageID.ascending(),
                  sessionID: childSession.id,
                  model: { modelID: model.modelID, providerID: model.providerID },
                  variant: next.model ? undefined : variant,
                  agent: next.name,
                  parts,
                })
                const text = res.parts.findLast((p) => p.type === "text")?.text ?? ""
                return {
                  id: itemId,
                  status: "completed" as const,
                  duration_ms: Date.now() - itemStart,
                  text,
                }
              }).pipe(
                Effect.timeout(Duration.millis(itemTimeoutMs)),
                Effect.catch((err) =>
                  Effect.gen(function* () {
                    yield* ops.cancel(childSession.id).pipe(Effect.ignore)
                    return {
                      id: itemId,
                      status: "error" as const,
                      duration_ms: Date.now() - start,
                      text: err instanceof Error ? err.message : String(err),
                    }
                  }),
                ),
              ),
            )
            return result
          }).pipe(
            Effect.catch((err) =>
              Effect.succeed({
                id: item["id"]!,
                status: "error" as const,
                duration_ms: 0,
                text: err instanceof Error ? err.message : String(err),
              }),
            ),
          )

        const results = yield* Effect.forEach(params.items, (item) => runItem(item as Record<string, string>), {
          concurrency: "unbounded",
        })
        return renderSwarmResults(results)
      })

      const inject = Effect.fn("SwarmTool.injectBackgroundResult")(function* (
        state: "completed" | "error",
        text: string,
      ) {
        const currentParent = yield* sessions.get(ctx.sessionID)
        yield* ops
          .prompt({
            sessionID: ctx.sessionID,
            agent: currentParent.agent ?? ctx.agent,
            variant,
            parts: [
              {
                type: "text",
                synthetic: true,
                text,
              },
            ],
          })
          .pipe(Effect.ignore, Effect.forkIn(scope, { startImmediately: true }))
      })

      const notify = Effect.fn("SwarmTool.notifyBackgroundResult")(function* (jobID: string) {
        yield* background.wait({ id: jobID }).pipe(
          Effect.flatMap((result) => {
            if (result.info?.status === "completed") return inject("completed", result.info.output ?? "")
            if (result.info?.status === "error") return inject("error", result.info.error ?? "")
            return Effect.void
          }),
          Effect.forkIn(scope, { startImmediately: true }),
        )
      })

      if (yield* background.extend({ id: coordinatorSession.id, run: runSwarm() })) {
        return {
          title: `swarm(${params.items.length} items)`,
          metadata: { ...metadata, background: true, jobId: coordinatorSession.id },
          output: BACKGROUND_UPDATED,
        }
      }

      const info = yield* background.start({
        id: coordinatorSession.id,
        type: id,
        title: `swarm(${params.items.length} items)`,
        metadata,
        onPromote: Effect.all([
          ctx.metadata({
            title: `swarm(${params.items.length} items)`,
            metadata: { ...metadata, background: true, jobId: coordinatorSession.id },
          }),
          notify(coordinatorSession.id),
        ]),
        run: runSwarm(),
      })

      function backgroundResult() {
        return {
          title: `swarm(${params.items.length} items)`,
          metadata: { ...metadata, background: true, jobId: info.id },
          output: BACKGROUND_STARTED,
        }
      }

      if (runInBackground) {
        yield* notify(info.id)
        return backgroundResult()
      }

      const runCancel = yield* EffectBridge.make()

      function onAbort() {
        runCancel.fork(background.cancel(coordinatorSession.id))
      }

      return yield* Effect.acquireUseRelease(
        Effect.sync(() => {
          ctx.abort.addEventListener("abort", onAbort)
        }),
        () =>
          Effect.gen(function* () {
            const result = yield* Effect.raceFirst(
              background.wait({ id: coordinatorSession.id }).pipe(Effect.map((waited) => waited.info)),
              background.waitForPromotion(coordinatorSession.id),
            )
            if (result?.metadata?.background === true) return backgroundResult()
            if (result?.status === "error") return yield* Effect.fail(new Error(result.error ?? "Swarm failed"))
            if (result?.status === "cancelled") return yield* Effect.fail(new Error("Swarm cancelled"))
            return {
              title: `swarm(${params.items.length} items)`,
              metadata,
              output: result?.output ?? "",
            }
          }),
        (_, exit) =>
          Effect.gen(function* () {
            if (Exit.hasInterrupts(exit)) yield* background.cancel(coordinatorSession.id).pipe(Effect.ignore)
          }).pipe(
            Effect.ensuring(
              Effect.sync(() => {
                ctx.abort.removeEventListener("abort", onAbort)
              }),
            ),
          ),
      )
    })

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
        run(params, ctx).pipe(Effect.orDie),
    }
  }),
)
