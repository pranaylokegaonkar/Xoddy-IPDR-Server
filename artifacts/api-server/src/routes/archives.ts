import { Router, type IRouter } from "express";
import { desc, eq, inArray } from "drizzle-orm";
import { db, flowArchivesTable } from "@workspace/db";
import { DeleteArchivesBody } from "@workspace/api-zod";
import { serializeArchive } from "../lib/serializers";
import { runCompression, getCompressionStatus } from "../lib/jobs";
import { recordAudit } from "../lib/audit";
import { recordArchiveLog } from "../lib/archive-log";

const router: IRouter = Router();

router.get("/archives", async (_req, res) => {
  const rows = await db
    .select()
    .from(flowArchivesTable)
    .orderBy(desc(flowArchivesTable.createdAt));
  res.json(rows.map(serializeArchive));
});

// Bulk delete selected archives. Defined before the `/archives/:id` routes so
// the literal `delete` segment is never parsed as an id.
router.post("/archives/delete", async (req, res): Promise<void> => {
  const parsed = DeleteArchivesBody.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const ids = parsed.data.ids;
  if (ids.length === 0) {
    res.json({ deleted: 0 });
    return;
  }
  const deleted = await db
    .delete(flowArchivesTable)
    .where(inArray(flowArchivesTable.id, ids))
    .returning({ id: flowArchivesTable.id });
  await recordAudit(req, "archive.delete", `Deleted ${deleted.length} archive(s)`);
  await recordArchiveLog(
    "info",
    "archive.delete",
    `Deleted ${deleted.length} archive file(s)`,
  );
  res.json({ deleted: deleted.length });
});

// Download a single archive as its gzipped .json.gz file.
router.get("/archives/:id/download", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db
    .select()
    .from(flowArchivesTable)
    .where(eq(flowArchivesTable.id, id));
  if (!row || !row.payload) {
    res.status(404).json({ error: "Archive not found" });
    return;
  }
  const buf = Buffer.from(row.payload, "base64");
  res.setHeader("Content-Type", "application/gzip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${row.fileName}"`,
  );
  res.setHeader("Content-Length", String(buf.length));
  await recordAudit(req, "archive.download", `Downloaded archive "${row.fileName}"`);
  res.send(buf);
});

router.delete("/archives/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db
    .delete(flowArchivesTable)
    .where(eq(flowArchivesTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Archive not found" });
    return;
  }
  await recordAudit(req, "archive.delete", `Deleted archive "${row.fileName}"`);
  await recordArchiveLog(
    "info",
    "archive.delete",
    `Deleted archive "${row.fileName}"`,
  );
  res.status(204).send();
});

router.post("/archives/compress", (req, res): void => {
  // Respond immediately and do ALL work in the background. The handler must not
  // touch flow_records synchronously: a large backlog (or an unindexed scan)
  // can outlast the reverse-proxy request timeout and surface as a 504. The
  // background job is a safe no-op when no window is ready, and it self-guards
  // against overlapping runs, so firing it unconditionally is fine. New
  // archives show up in the list as each window completes.
  void recordArchiveLog(
    "info",
    "compression.trigger",
    "Manual compression run requested",
  );
  void runCompression()
    .then((results) =>
      req.log.info({ created: results.length }, "Manual compression run finished"),
    )
    .catch((err) => req.log.error({ err }, "Manual compression run failed"));

  res.status(202).json({
    status: "started",
    message: "Compression started. New archives will appear as each window completes.",
  });
});

router.get("/archives/compress/status", (_req, res) => {
  res.json(getCompressionStatus());
});

export default router;
