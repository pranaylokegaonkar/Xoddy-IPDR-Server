import type { Request } from "express";
import { db, auditLogsTable } from "@workspace/db";

function clientIp(req: Request): string | null {
  // Use Express's resolved `req.ip`, which honors the configured `trust proxy`
  // setting. Parsing the raw `x-forwarded-for` header ourselves would let
  // clients spoof the recorded source IP.
  return req.ip ?? null;
}

/**
 * Record an audit-log entry for a user action. The acting user is taken from
 * the session unless an explicit `actor` override is supplied (used for events
 * like failed logins where no session exists yet). Never throws — audit
 * failures are logged but must not break the underlying request.
 */
export async function recordAudit(
  req: Request,
  action: string,
  detail?: string,
  actor?: { id?: number | null; username?: string },
): Promise<void> {
  try {
    const sessionUser = req.session?.user;
    await db.insert(auditLogsTable).values({
      userId: actor?.id ?? sessionUser?.id ?? null,
      username: actor?.username ?? sessionUser?.username ?? "anonymous",
      action,
      detail: detail ?? null,
      ipAddress: clientIp(req),
    });
  } catch (err) {
    req.log.error({ err }, "Failed to record audit log");
  }
}
