import { pgTable, serial, text, timestamp, index } from "drizzle-orm/pg-core";

export const archiveLogsTable = pgTable(
  "archive_logs",
  {
    id: serial("id").primaryKey(),
    level: text("level").notNull(),
    event: text("event").notNull(),
    message: text("message").notNull(),
    detail: text("detail"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("archive_logs_created_idx").on(t.createdAt)],
);

export type ArchiveLogRow = typeof archiveLogsTable.$inferSelect;
export type InsertArchiveLog = typeof archiveLogsTable.$inferInsert;
