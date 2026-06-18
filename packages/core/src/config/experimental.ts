export * as ConfigExperimental from "./experimental"

import { Schema } from "effect"
import { Catalog } from "../catalog"
import { Policy as PolicyV2 } from "../policy"
import { PositiveInt } from "../schema"

// Each core domain exports the policy actions it supports. Adding an action to
// this union makes it valid in authored config while keeping Policy generic.
export const PolicyAction = Schema.Union([Catalog.PolicyActions])

export class Policy extends Schema.Class<Policy>("ConfigV2.Experimental.Policy")({
  ...PolicyV2.Info.fields,
  action: PolicyAction,
}) {}

export class Experimental extends Schema.Class<Experimental>("ConfigV2.Experimental")({
  policies: Policy.pipe(Schema.Array, Schema.optional),
  swarm: Schema.Boolean.pipe(Schema.optional),
  swarm_max_items: PositiveInt.pipe(Schema.optional),
  swarm_concurrency: PositiveInt.pipe(Schema.optional),
  swarm_item_timeout_ms: PositiveInt.pipe(Schema.optional),
}) {}
