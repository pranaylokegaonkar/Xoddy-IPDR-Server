import { eq } from "drizzle-orm";
import { db, flowArchivesTable } from "@workspace/db";
import { ArchiveDeletionJob } from "./archive-deletion-job";
import { deleteArchiveFromShare } from "./archive-storage";
import { logger } from "./logger";

export const archiveDeletion = new ArchiveDeletionJob({
  async deleteOne(id, setFileName) {
    // Never fetch the compressed payload. Delete one selected archive per
    // statement so large TOAST payloads do not form a single huge transaction.
    const [row] = await db.select({
      id: flowArchivesTable.id,
      fileName: flowArchivesTable.fileName,
      storageKey: flowArchivesTable.storageKey,
    }).from(flowArchivesTable).where(eq(flowArchivesTable.id, id));
    if (!row) return "missing";
    setFileName(row.fileName);
    const deleted = await db.delete(flowArchivesTable)
      .where(eq(flowArchivesTable.id, id)).returning({ id: flowArchivesTable.id });
    if (!deleted.length) return "missing";
    if (row.storageKey) {
      try { await deleteArchiveFromShare(row.storageKey); }
      catch (error) {
        logger.error({ err: error, archiveId: id }, "Archive entry deleted but share file cleanup failed");
        return "cleanup-failed";
      }
    }
    return "deleted";
  },
  onError(error, id) {
    logger.error({ err: error, archiveId: id }, "Archive deletion job error");
  },
});
