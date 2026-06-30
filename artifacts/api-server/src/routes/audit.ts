import { Router, type IRouter } from "express";
import { eq, desc, and, count, type SQL } from "drizzle-orm";
import { db, auditLogsTable } from "@workspace/db";
import { serializeAuditLog } from "../lib/serializers";

const router: IRouter = Router();

const MAX_PAGE_SIZE = 50;

router.get("/audit-logs", async (req, res) => {
  const pageRaw = Number(req.query.page);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
  const pageSizeRaw = Number(req.query.pageSize);
  const pageSize =
    Number.isFinite(pageSizeRaw) && pageSizeRaw > 0
      ? Math.min(Math.floor(pageSizeRaw), MAX_PAGE_SIZE)
      : MAX_PAGE_SIZE;

  const conditions: SQL[] = [];
  if (typeof req.query.action === "string" && req.query.action.length > 0) {
    conditions.push(eq(auditLogsTable.action, req.query.action));
  }
  const userIdRaw = Number(req.query.userId);
  if (Number.isFinite(userIdRaw) && userIdRaw > 0) {
    conditions.push(eq(auditLogsTable.userId, userIdRaw));
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const [totalRow] = await db
    .select({ value: count() })
    .from(auditLogsTable)
    .where(where);
  const total = totalRow?.value ?? 0;

  const rows = await db
    .select()
    .from(auditLogsTable)
    .where(where)
    .orderBy(desc(auditLogsTable.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  res.json({ items: rows.map(serializeAuditLog), total, page, pageSize });
});

export default router;
