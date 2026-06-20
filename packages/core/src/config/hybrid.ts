export * as ConfigHybrid from "./hybrid"

import { Schema } from "effect"
import { PositiveInt } from "../schema"

export class CheapModel extends Schema.Class<CheapModel>("ConfigV2.Hybrid.CheapModel")({
  providerID: Schema.String,
  modelID: Schema.String,
}) {}

export class Info extends Schema.Class<Info>("ConfigV2.Hybrid")({
  enabled: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "Enable hybrid routing and tool-output compression (default false)",
  }),
  cheap_model: CheapModel.pipe(Schema.optional).annotate({
    description: "Cheap model lightweight tasks route to when hybrid is enabled",
  }),
  compression_threshold_lines: PositiveInt.pipe(Schema.optional).annotate({
    description: "Compress tool outputs only above this line count (default 40)",
  }),
  compression_timeout_ms: PositiveInt.pipe(Schema.optional).annotate({
    description: "Abandon a compression call after this many milliseconds (default 5000)",
  }),
  compression_max_tokens: PositiveInt.pipe(Schema.optional).annotate({
    description: "Cap compression output tokens (default 1024)",
  }),
  compression_tail_lines: PositiveInt.pipe(Schema.optional).annotate({
    description: "Preserve the last N original lines verbatim after compression (default 3)",
  }),
  log_routing: Schema.Boolean.pipe(Schema.optional).annotate({
    description: "Log routing and compression decisions for diagnostics (default false)",
  }),
}) {}
