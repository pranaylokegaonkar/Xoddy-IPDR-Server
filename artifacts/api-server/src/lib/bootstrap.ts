import { sql } from "drizzle-orm";
import { db, systemUsersTable } from "@workspace/db";
import { hashPassword } from "./password";
import { logger } from "./logger";

/**
 * Create a default administrator the first time the server runs against an
 * empty user table. Without this, authentication would lock everyone out
 * because creating users itself requires being logged in. The credentials can
 * be overridden via BOOTSTRAP_ADMIN_USERNAME / BOOTSTRAP_ADMIN_PASSWORD.
 */
export async function ensureBootstrapAdmin(): Promise<void> {
  try {
    const [row] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(systemUsersTable);
    if ((row?.count ?? 0) > 0) return;

    const username = process.env.BOOTSTRAP_ADMIN_USERNAME?.trim() || "admin";
    const password = process.env.BOOTSTRAP_ADMIN_PASSWORD?.trim() || "admin";

    await db.insert(systemUsersTable).values({
      username,
      fullName: "Administrator",
      email: null,
      userType: "admin",
      passwordHash: hashPassword(password),
      enabled: true,
    });

    logger.warn(
      { username },
      `No system users found — created a default administrator (username "${username}"). Sign in and change this password immediately.`,
    );
  } catch (err) {
    logger.error({ err }, "Failed to ensure bootstrap admin user");
  }
}
