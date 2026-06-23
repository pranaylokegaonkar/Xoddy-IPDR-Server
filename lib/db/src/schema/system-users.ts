import {
  pgTable,
  serial,
  text,
  boolean,
  timestamp,
} from "drizzle-orm/pg-core";

export const systemUsersTable = pgTable("system_users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  fullName: text("full_name").notNull(),
  email: text("email"),
  userType: text("user_type").notNull().default("operator"),
  passwordHash: text("password_hash").notNull(),
  enabled: boolean("enabled").notNull().default(true),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type SystemUserRow = typeof systemUsersTable.$inferSelect;
export type InsertSystemUser = typeof systemUsersTable.$inferInsert;
