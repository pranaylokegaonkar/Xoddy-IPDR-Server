import { Router, type IRouter } from "express";
import { desc } from "drizzle-orm";
import { db, flowArchivesTable } from "@workspace/db";
import { serializeArchive } from "../lib/serializers";
import { runCompression } from "../lib/jobs";

const router: IRouter = Router();

router.get("/archives", async (_req, res) => {
  const rows = await db
    .select()
    .from(flowArchivesTable)
    .orderBy(desc(flowArchivesTable.createdAt));
  res.json(rows.map(serializeArchive));
});

router.post("/archives/compress", async (req, res): Promise<void> => {
  const results = await runCompression();
  if (results.length === 0) {
    res.status(400).json({
      error: "No completed 2-hour windows are ready to compress yet.",
    });
    return;
  }
  // One run can archive several elapsed windows; report the newest (last).
  const result = results[results.length - 1]!;
  res.json({
    id: result.id,
    fileName: result.fileName,
    recordCount: result.recordCount,
    originalBytes: result.originalBytes,
    compressedBytes: result.compressedBytes,
    periodStart: result.periodStart.toISOString(),
    periodEnd: result.periodEnd.toISOString(),
    createdAt: result.createdAt.toISOString(),
  });
});

export default router;
