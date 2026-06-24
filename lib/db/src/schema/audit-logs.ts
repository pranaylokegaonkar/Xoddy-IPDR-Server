import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const auditLogsTable = pgTable("audit_logs", {
  id: serial("id").primaryKey(),
  userId: integer("user_id"),
  username: text("username").notNull(),
  action: text("action").notNull(),
  detail: text("detail"),
  ipAddress: text("ip_address"),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type AuditLogRow = typeof auditLogsTable.$inferSelect;
export type InsertAuditLog = typeof auditLogsTable.$inferInsert;
