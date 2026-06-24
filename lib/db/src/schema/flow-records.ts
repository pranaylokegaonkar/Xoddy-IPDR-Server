import {
  pgTable,
  serial,
  text,
  integer,
  bigint,
  date,
  timestamp,
  index,
} from "drizzle-orm/pg-core";

export const flowRecordsTable = pgTable(
  "flow_records",
  {
    id: serial("id").primaryKey(),
    nasId: integer("nas_id").notNull(),
    srcIp: text("src_ip").notNull(),
    dstIp: text("dst_ip").notNull(),
    srcNatIp: text("src_nat_ip"),
    dstNatIp: text("dst_nat_ip"),
    srcPort: integer("src_port").notNull(),
    dstPort: integer("dst_port").notNull(),
    protocol: integer("protocol").notNull(),
    bytes: bigint("bytes", { mode: "number" }).notNull(),
    packets: bigint("packets", { mode: "number" }).notNull(),
    flowVersion: text("flow_version").notNull(),
    startTime: timestamp("start_time", { withTimezone: true }).notNull(),
    endTime: timestamp("end_time", { withTimezone: true }).notNull(),
    flowDate: date("flow_date", { mode: "string" }).notNull(),
    archived: integer("archived").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    index("flow_records_nas_idx").on(t.nasId),
    index("flow_records_date_idx").on(t.flowDate),
    index("flow_records_src_idx").on(t.srcIp),
    index("flow_records_dst_idx").on(t.dstIp),
    // Drives the compression queries: find the earliest unarchived record and
    // select a window's unarchived rows by end_time. Without this, every
    // compression run full-scans flow_records.
    index("flow_records_archived_end_idx").on(t.archived, t.endTime),
  ],
);

export type FlowRecordRow = typeof flowRecordsTable.$inferSelect;
export type InsertFlowRecord = typeof flowRecordsTable.$inferInsert;
