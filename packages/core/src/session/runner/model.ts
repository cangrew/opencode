export * as SessionRunnerModel from "./model"

import { type Model } from "@opencode-ai/llm"
import * as AnthropicMessages from "@opencode-ai/llm/protocols/anthropic-messages"
import * as OpenAICompatibleChat from "@opencode-ai/llm/protocols/openai-compatible-chat"
import * as OpenAIResponses from "@opencode-ai/llm/protocols/openai-responses"
import { Auth, type AnyRoute } from "@opencode-ai/llm/route"
import { Context, Effect, Layer, Option, Schema } from "effect"
import { produce } from "immer"
import { Catalog } from "../../catalog"
import { Credential } from "../../credential"
import { Integration } from "../../integration"
import { IntegrationConnection } from "../../integration/connection"
import { ModelV2 } from "../../model"
import { ModelRequest } from "../../model-request"
import { PluginBoot } from "../../plugin/boot"
import { ProviderV2 } from "../../provider"
import { SessionSchema } from "../schema"

export class ModelNotSelectedError extends Schema.TaggedErrorClass<ModelNotSelectedError>()(
  "SessionRunnerModel.ModelNotSelectedError",
  {
    sessionID: SessionSchema.ID,
  },
) {}

export class UnsupportedApiError extends Schema.TaggedErrorClass<UnsupportedApiError>()(
  "SessionRunnerModel.UnsupportedApiError",
  {
    providerID: ProviderV2.ID,
    modelID: ModelV2.ID,
    api: Schema.String,
  },
) {}

export type Error =
  | Catalog.ProviderNotFoundError
  | Catalog.ModelNotFoundError
  | ModelNotSelectedError
  | UnsupportedApiError

export interface Ref {
  readonly providerID: string
  readonly modelID: string
  readonly variant?: ModelV2.VariantID
}

export interface Interface {
  readonly resolve: (session: SessionSchema.Info) => Effect.Effect<Model, Error>
  readonly resolveRef: (ref: Ref) => Effect.Effect<Model, Error>
}

export class Service extends Context.Service<Service, Interface>()("@opencode/v2/SessionRunnerModel") {}

export const layerWith = (resolve: Interface["resolve"], resolveRef?: Interface["resolveRef"]) =>
  Layer.succeed(
    Service,
    Service.of({
      resolve,
      resolveRef:
        resolveRef ??
        ((ref) =>
          Effect.fail(
            new UnsupportedApiError({
              providerID: ProviderV2.ID.make(ref.providerID),
              modelID: ModelV2.ID.make(ref.modelID),
              api: "resolveRef not supported in this seam",
            }),
          )),
    }),
  )

const apiKey = (model: ModelV2.Info, connection?: IntegrationConnection.Info, credential?: Credential.Stored) => {
  if (credential?.value.type === "key") return Auth.value(credential.value.key)
  if (credential?.value.type === "oauth") return Auth.value(credential.value.access)
  const value = model.request.body.apiKey ?? model.api.settings?.apiKey
  if (typeof value === "string") return Auth.value(value)
  return connection?.type === "env" ? Auth.config(connection.name) : undefined
}

const withDefaults = (model: ModelV2.Info, route: AnyRoute) => {
  const options = model.request.options ?? {}
  const namespace = model.api.type === "aisdk" ? ModelRequest.namespace(model.api.package) : undefined
  const body = model.request.body
  const httpBody = Object.hasOwn(body, "apiKey")
    ? Object.fromEntries(Object.entries(body).filter(([key]) => key !== "apiKey"))
    : body
  return route.with({
    provider: model.providerID,
    endpoint: model.api.url === undefined ? undefined : { baseURL: model.api.url },
    headers: model.request.headers,
    generation: model.request.generation,
    providerOptions: namespace && Object.keys(options).length > 0 ? { [namespace]: options } : undefined,
    http: { body: httpBody },
    limits: { context: model.limit.context, output: model.limit.output },
  })
}

const withVariant = (model: ModelV2.Info, variantID: ModelV2.VariantID | undefined) => {
  const id = variantID === "default" || variantID === undefined ? model.request.variant : variantID
  const variant = model.variants.find((item) => item.id === id)
  if (!variant) return model
  return produce(model, (draft) => {
    ModelRequest.assign(draft.request, variant)
  })
}

const apiName = (model: ModelV2.Info) =>
  model.api.type === "aisdk" ? `${model.api.type}:${model.api.package}` : model.api.type

export const fromCatalogModel = (
  model: ModelV2.Info,
  connection?: IntegrationConnection.Info,
  credential?: Credential.Stored,
): Effect.Effect<Model, UnsupportedApiError> => {
  const resolved =
    credential?.value.metadata === undefined
      ? model
      : produce(model, (draft) => {
          Object.assign(draft.request.body, credential.value.metadata)
        })
  const key = apiKey(resolved, connection, credential)
  if (resolved.api.type === "aisdk" && resolved.api.package === "@ai-sdk/openai") {
    return Effect.succeed(
      withDefaults(resolved, OpenAIResponses.route)
        .with({ auth: key === undefined ? Auth.none : Auth.bearer(key) })
        .model({ id: resolved.api.id }),
    )
  }
  if (resolved.api.type === "aisdk" && resolved.api.package === "@ai-sdk/anthropic") {
    return Effect.succeed(
      withDefaults(resolved, AnthropicMessages.route)
        .with({ auth: key === undefined ? Auth.none : Auth.header("x-api-key", key) })
        .model({ id: resolved.api.id }),
    )
  }
  if (resolved.api.type === "aisdk" && resolved.api.package === "@ai-sdk/openai-compatible" && resolved.api.url) {
    return Effect.succeed(
      withDefaults(resolved, OpenAICompatibleChat.route)
        .with({ auth: key === undefined ? Auth.none : Auth.bearer(key) })
        .model({ id: resolved.api.id }),
    )
  }
  return Effect.fail(
    new UnsupportedApiError({
      providerID: resolved.providerID,
      modelID: resolved.id,
      api: apiName(resolved),
    }),
  )
}

export const resolve = (session: SessionSchema.Info, model: ModelV2.Info) =>
  fromCatalogModel(withVariant(model, session.model?.variant))

export const supported = (model: ModelV2.Info) =>
  model.api.type === "aisdk" &&
  (model.api.package === "@ai-sdk/openai" ||
    model.api.package === "@ai-sdk/anthropic" ||
    (model.api.package === "@ai-sdk/openai-compatible" && model.api.url !== undefined))

/** Resolves models from the catalog belonging to the current Location runtime. */
export const locationLayer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const catalog = yield* Catalog.Service
    const credentials = yield* Credential.Service
    const integrations = yield* Integration.Service
    const boot = yield* PluginBoot.Service
    const resolveSelected = Effect.fn("SessionRunnerModel.resolveSelected")(function* (
      selected: ModelV2.Info,
      variant: ModelV2.VariantID | undefined,
    ) {
      const connection = yield* integrations.connection.forIntegration(Integration.ID.make(selected.providerID))
      return yield* fromCatalogModel(
        withVariant(selected, variant),
        connection,
        connection?.type === "credential" ? yield* credentials.get(connection.id) : undefined,
      )
    })
    return Service.of({
      resolve: Effect.fn("SessionRunnerModel.resolve")(function* (session) {
        // Location plugins populate and filter the catalog asynchronously during layer startup.
        yield* boot.wait()
        const selected = session.model
          ? yield* catalog.model.get(session.model.providerID, session.model.id)
          : (Option.getOrUndefined((yield* catalog.model.default()).pipe(Option.filter(supported))) ??
            (yield* catalog.model.available()).find(supported))
        if (!selected) return yield* new ModelNotSelectedError({ sessionID: session.id })
        return yield* resolveSelected(selected, session.model?.variant)
      }),
      resolveRef: Effect.fn("SessionRunnerModel.resolveRef")(function* (ref) {
        yield* boot.wait()
        const providerID = ProviderV2.ID.make(ref.providerID)
        const modelID = ModelV2.ID.make(ref.modelID)
        // Only resolve refs that point at an enabled model on an available provider.
        // catalog.model.get ignores disabled/unavailable state, which would route to a
        // model that cannot serve requests instead of falling back to the main model.
        const selected = (yield* catalog.model.available()).find(
          (model) => model.providerID === providerID && model.id === modelID,
        )
        if (!selected) return yield* new Catalog.ModelNotFoundError({ providerID, modelID })
        return yield* resolveSelected(selected, ref.variant)
      }),
    })
  }),
)
