import {
  pgTable,
  serial,
  text,
  integer,
  bigint,
  boolean,
  index,
  timestamp,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

export const flowArchivesTable = pgTable("flow_archives", {
  id: serial("id").primaryKey(),
  fileName: text("file_name").notNull(),
  // NAS this archive belongs to. Nullable for backward compatibility with
  // pre-existing archives that bundled all NAS devices into one window file.
  nasId: integer("nas_id"),
  nasName: text("nas_name"),
  nasIp: text("nas_ip"),
  recordCount: integer("record_count").notNull(),
  originalBytes: bigint("original_bytes", { mode: "number" }).notNull(),
  compressedBytes: bigint("compressed_bytes", { mode: "number" }).notNull(),
  payload: text("payload"),
  // Imported backups are searchable but are never evidence for deleting live rows.
  isImported: boolean("is_imported").notNull().default(false),
  // Relative filename on the configured Windows SMB share. Older archive rows
  // keep a null storageKey and continue to use their database payload.
  storageKey: text("storage_key"),
  periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
  periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (t) => [
  // Only new archive rows awaiting delivery to the share are indexed.
  index("flow_archives_share_pending_idx")
    .on(t.id)
    .where(sql`${t.storageKey} IS NOT NULL AND ${t.payload} IS NOT NULL`),
  index("flow_archives_period_start_idx").on(t.periodStart),
]);

export type FlowArchiveRow = typeof flowArchivesTable.$inferSelect;
export type InsertFlowArchive = typeof flowArchivesTable.$inferInsert;
