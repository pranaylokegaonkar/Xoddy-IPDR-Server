import { Router, type IRouter } from "express";
import { eq, desc, and, type SQL } from "drizzle-orm";
import { db, auditLogsTable } from "@workspace/db";
import { serializeAuditLog } from "../lib/serializers";

const router: IRouter = Router();

router.get("/audit-logs", async (req, res) => {
  const limitRaw = Number(req.query.limit);
  const limit =
    Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 1000) : 200;

  const conditions: SQL[] = [];
  if (typeof req.query.action === "string" && req.query.action.length > 0) {
    conditions.push(eq(auditLogsTable.action, req.query.action));
  }
  const userIdRaw = Number(req.query.userId);
  if (Number.isFinite(userIdRaw) && userIdRaw > 0) {
    conditions.push(eq(auditLogsTable.userId, userIdRaw));
  }

  const rows = await db
    .select()
    .from(auditLogsTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(limit);

  res.json(rows.map(serializeAuditLog));
});

export default router;
