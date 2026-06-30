import { Router, type IRouter } from "express";
import { eq, desc, and, count, type SQL } from "drizzle-orm";
import { db, archiveLogsTable } from "@workspace/db";
import { serializeArchiveLog } from "../lib/serializers";

const router: IRouter = Router();

const MAX_PAGE_SIZE = 50;
const LEVELS = ["info", "warning", "error"];

router.get("/archive-logs", async (req, res) => {
  const pageRaw = Number(req.query.page);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.floor(pageRaw) : 1;
  const pageSizeRaw = Number(req.query.pageSize);
  const pageSize =
    Number.isFinite(pageSizeRaw) && pageSizeRaw > 0
      ? Math.min(Math.floor(pageSizeRaw), MAX_PAGE_SIZE)
      : MAX_PAGE_SIZE;

  const conditions: SQL[] = [];
  const level = req.query.level;
  if (typeof level === "string" && LEVELS.includes(level)) {
    conditions.push(eq(archiveLogsTable.level, level));
  }
  const where = conditions.length ? and(...conditions) : undefined;

  const [totalRow] = await db
    .select({ value: count() })
    .from(archiveLogsTable)
    .where(where);
  const total = totalRow?.value ?? 0;

  const rows = await db
    .select()
    .from(archiveLogsTable)
    .where(where)
    .orderBy(desc(archiveLogsTable.createdAt))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  res.json({ items: rows.map(serializeArchiveLog), total, page, pageSize });
});

export default router;
