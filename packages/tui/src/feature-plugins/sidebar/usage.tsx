import type { AssistantMessage, SubscriptionUsageInfo } from "@opencode-ai/sdk/v2"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo } from "solid-js"

const id = "internal:sidebar-usage"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

const tokenTotal = (message: AssistantMessage) =>
  message.tokens.input +
  message.tokens.output +
  message.tokens.reasoning +
  message.tokens.cache.read +
  message.tokens.cache.write

const countdown = (resetsAt: number) => {
  const remaining = Math.max(0, resetsAt - Date.now())
  const minutes = Math.round(remaining / 60_000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  if (rest === 0) return `${hours}h`
  return `${hours}h ${rest}m`
}

const activeOpenAIUsage = (items: ReadonlyArray<SubscriptionUsageInfo>) => items.find((item) => item.provider === "openai")

const number = (value: number | string) => (typeof value === "number" ? value : Number(value))

function Meter(props: { label: string; percent: number; reset: number }) {
  return (
    <box flexDirection="column">
      <text>
        <b>{props.label}</b>
      </text>
      <text>{props.percent}% used</text>
      <text>resets in {countdown(props.reset)}</text>
    </box>
  )
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const messages = createMemo(() => props.api.state.session.messages(props.session_id))
  const session = createMemo(() => props.api.state.session.get(props.session_id))
  const usage = createMemo(() => activeOpenAIUsage(props.api.state.subscriptionUsage()))

  const context = createMemo(() => {
    const last = messages().findLast((item): item is AssistantMessage => item.role === "assistant" && tokenTotal(item) > 0)
    if (!last) return { tokens: 0, percent: null as number | null }
    const model = props.api.state.provider.find((item) => item.id === last.providerID)?.models[last.modelID]
    const tokens = tokenTotal(last)
    return {
      tokens,
      percent: model?.limit.context ? Math.round((tokens / model.limit.context) * 100) : null,
    }
  })

  const totals = createMemo(() => session()?.tokens ?? { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } })

  return (
    <box flexDirection="column">
      <text fg={theme().text}>
        <b>Usage</b>
      </text>
      <text fg={theme().textMuted}>input {totals().input.toLocaleString()}</text>
      <text fg={theme().textMuted}>output {totals().output.toLocaleString()}</text>
      <text fg={theme().textMuted}>reasoning {totals().reasoning.toLocaleString()}</text>
      <text fg={theme().textMuted}>cache {totals().cache.read.toLocaleString()} read / {totals().cache.write.toLocaleString()} write</text>
      <text fg={theme().textMuted}>{money.format(session()?.cost ?? 0)} spent</text>
      <text fg={theme().textMuted}>{context().percent ?? 0}% context used</text>
      {usage()?.primary ? <Meter label="Primary" percent={number(usage()!.primary!.usedPercent)} reset={usage()!.primary!.resetsAt} /> : null}
      {usage()?.secondary ? (
        <Meter label="Secondary" percent={number(usage()!.secondary!.usedPercent)} reset={usage()!.secondary!.resetsAt} />
      ) : null}
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 101,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
