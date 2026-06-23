import {
  pgTable,
  serial,
  text,
  integer,
  bigint,
  timestamp,
} from "drizzle-orm/pg-core";

export const flowArchivesTable = pgTable("flow_archives", {
  id: serial("id").primaryKey(),
  fileName: text("file_name").notNull(),
  recordCount: integer("record_count").notNull(),
  originalBytes: bigint("original_bytes", { mode: "number" }).notNull(),
  compressedBytes: bigint("compressed_bytes", { mode: "number" }).notNull(),
  payload: text("payload"),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type FlowArchiveRow = typeof flowArchivesTable.$inferSelect;
export type InsertFlowArchive = typeof flowArchivesTable.$inferInsert;
