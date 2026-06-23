import {
  pgTable,
  serial,
  text,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";

export const nasDevicesTable = pgTable("nas_devices", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  ipAddress: text("ip_address").notNull(),
  location: text("location"),
  description: text("description"),
  flowVersion: text("flow_version").notNull().default("v9"),
  enabled: boolean("enabled").notNull().default(true),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type NasDeviceRow = typeof nasDevicesTable.$inferSelect;
export type InsertNasDevice = typeof nasDevicesTable.$inferInsert;
