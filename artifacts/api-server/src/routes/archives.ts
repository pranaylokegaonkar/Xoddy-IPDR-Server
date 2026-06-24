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

router.post("/archives/compress", (req, res): void => {
  // Respond immediately and do ALL work in the background. The handler must not
  // touch flow_records synchronously: a large backlog (or an unindexed scan)
  // can outlast the reverse-proxy request timeout and surface as a 504. The
  // background job is a safe no-op when no window is ready, and it self-guards
  // against overlapping runs, so firing it unconditionally is fine. New
  // archives show up in the list as each window completes.
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

export default router;
