import { Router, type IRouter } from "express";
import { desc } from "drizzle-orm";
import { db, flowArchivesTable } from "@workspace/db";
import { serializeArchive } from "../lib/serializers";
import { runCompression, hasReadyWindow } from "../lib/jobs";

const router: IRouter = Router();

router.get("/archives", async (_req, res) => {
  const rows = await db
    .select()
    .from(flowArchivesTable)
    .orderBy(desc(flowArchivesTable.createdAt));
  res.json(rows.map(serializeArchive));
});

router.post("/archives/compress", async (req, res): Promise<void> => {
  // Reject early if nothing is ready, so the user still gets clear feedback.
  if (!(await hasReadyWindow())) {
    res.status(400).json({
      error: "No completed 2-hour windows are ready to compress yet.",
    });
    return;
  }

  // Run the compression in the background and respond immediately. A large
  // first-time backlog can take far longer than the reverse-proxy request
  // timeout, so we never block the HTTP request on it; new archives show up in
  // the list as each window completes.
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
