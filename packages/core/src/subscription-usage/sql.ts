import { primaryKey, sqliteTable, text, integer } from "drizzle-orm/sqlite-core"
import { Timestamps } from "../database/schema.sql"
import { ProviderV2 } from "../provider"
import { SubscriptionUsage } from "../subscription-usage"

type StoredWindow = {
  usedPercent: number
  windowMinutes: number
  resetsAt: string
}

export const SubscriptionUsageTable = sqliteTable(
  "subscription_usage",
  {
    provider: text().$type<ProviderV2.ID>().notNull(),
    account_id: text().$type<SubscriptionUsage.AccountID>().notNull(),
    primary_window: text({ mode: "json" }).$type<StoredWindow>(),
    secondary_window: text({ mode: "json" }).$type<StoredWindow>(),
    captured_at: integer().notNull(),
    ...Timestamps,
  },
  (table) => [primaryKey({ columns: [table.provider, table.account_id] })],
)
