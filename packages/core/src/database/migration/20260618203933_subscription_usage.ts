import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260618203933_subscription_usage",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`subscription_usage\` (
          \`provider\` text NOT NULL,
          \`account_id\` text NOT NULL,
          \`primary_window\` text,
          \`secondary_window\` text,
          \`captured_at\` integer NOT NULL,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL,
          CONSTRAINT \`subscription_usage_pk\` PRIMARY KEY(\`provider\`, \`account_id\`)
        );
      `)
    })
  },
} satisfies DatabaseMigration.Migration
