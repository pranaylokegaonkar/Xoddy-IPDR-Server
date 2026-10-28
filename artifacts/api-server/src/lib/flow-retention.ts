import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { db, flowArchivesTable, flowRecordsTable } from "@workspace/db";
import { logger } from "./logger";
import { recordArchiveLog } from "./archive-log";
import { isArchiveDurable } from "./archive-storage";

const FLOW_RETENTION_MS = 24 * 60 * 60 * 1000;
const IST_WINDOW_MS = 2 * 60 * 60 * 1000;
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const WINDOW_BATCH_SIZE = 128;
const DELETE_BATCH_SIZE = 5000;
const MAX_DELETE_PER_RUN = 100_000;

interface ArchiveWindow {
  periodStart: Date;
  periodEnd: Date;
  latestArchiveAt: Date;
  archiveRecordCount: number;
}

function isAlignedIstWindow(window: ArchiveWindow): boolean {
  const istStart = window.periodStart.getTime() + IST_OFFSET_MS;
  return (
    window.periodEnd.getTime() - window.periodStart.getTime() === IST_WINDOW_MS &&
    istStart % IST_WINDOW_MS === 0
  );
}

/**
 * Deletes original flow rows only after a full day has passed since the latest
 * archive for their fixed time window. All archive copies for the window must
 * still be durable, and their combined record count must cover the remaining
 * source rows. This also safely handles older rows that predate a row-to-archive
 * id link, plus late-arrival archives for the same window.
 */
export async function deleteExpiredArchivedFlowRows(): Promise<number> {
  const cutoff = new Date(Date.now() - FLOW_RETENTION_MS);
  const windows = await db
    .select({
      periodStart: flowArchivesTable.periodStart,
      periodEnd: flowArchivesTable.periodEnd,
      latestArchiveAt: sql<Date>`max(${flowArchivesTable.createdAt})`,
      archiveRecordCount: sql<number>`cast(sum(${flowArchivesTable.recordCount}) as int)`,
    })
    .from(flowArchivesTable)
    .groupBy(flowArchivesTable.periodStart, flowArchivesTable.periodEnd)
    .having(sql`max(${flowArchivesTable.createdAt}) <= ${cutoff}`)
    .orderBy(asc(flowArchivesTable.periodStart))
    .limit(WINDOW_BATCH_SIZE);

  if (windows.length === 0) return 0;

  const [maxArchivedRow] = await db
    .select({ id: flowRecordsTable.id })
    .from(flowRecordsTable)
    .where(eq(flowRecordsTable.archived, 1))
    .orderBy(desc(flowRecordsTable.id))
    .limit(1);
  const cutoffId = maxArchivedRow?.id;
  if (cutoffId == null) return 0;

  let deletedTotal = 0;
  for (const window of windows) {
    if (deletedTotal >= MAX_DELETE_PER_RUN) break;
    if (!isAlignedIstWindow(window)) {
      logger.warn(
        { periodStart: window.periodStart, periodEnd: window.periodEnd },
        "Skipping automatic flow cleanup for a nonstandard archive window",
      );
      continue;
    }

    const rowConditions = and(
      eq(flowRecordsTable.archived, 1),
      gte(flowRecordsTable.endTime, window.periodStart),
      lt(flowRecordsTable.endTime, window.periodEnd),
      lte(flowRecordsTable.id, cutoffId),
    );
    const [sourceCount] = await db
      .select({
        count: sql<number>`cast(count(*) as int)`,
      })
      .from(flowRecordsTable)
      .where(rowConditions);

    const remainingRows = sourceCount?.count ?? 0;
    if (remainingRows === 0) continue;
    if (remainingRows > window.archiveRecordCount) {
      await recordArchiveLog(
        "warning",
        "flow.cleanup.coverage_mismatch",
        `Kept ${remainingRows} original flow row(s): archives cover only ${window.archiveRecordCount} record(s) for this window`,
      );
      continue;
    }

    const archives = await db
      .select({
        payload: flowArchivesTable.payload,
        storageKey: flowArchivesTable.storageKey,
        compressedBytes: flowArchivesTable.compressedBytes,
        recordCount: flowArchivesTable.recordCount,
      })
      .from(flowArchivesTable)
      .where(
        and(
          eq(flowArchivesTable.periodStart, window.periodStart),
          eq(flowArchivesTable.periodEnd, window.periodEnd),
        ),
      );

    let durableRecordCount = 0;
    let allArchivesDurable = archives.length > 0;
    for (const archive of archives) {
      if (!(await isArchiveDurable(archive))) {
        allArchivesDurable = false;
        break;
      }
      durableRecordCount += archive.recordCount;
    }

    if (
      !allArchivesDurable ||
      durableRecordCount < window.archiveRecordCount
    ) {
      await recordArchiveLog(
        "warning",
        "flow.cleanup.archive_unavailable",
        `Kept original flow rows for ${window.periodStart.toISOString()}: an archive copy could not be verified`,
      );
      continue;
    }

    let deletedWindow = 0;
    while (deletedTotal < MAX_DELETE_PER_RUN) {
      const batchSize = Math.min(
        DELETE_BATCH_SIZE,
        MAX_DELETE_PER_RUN - deletedTotal,
      );
      const result = await db.delete(flowRecordsTable).where(
        inArray(
          flowRecordsTable.id,
          db
            .select({ id: flowRecordsTable.id })
            .from(flowRecordsTable)
            .where(rowConditions)
            .orderBy(asc(flowRecordsTable.id))
            .limit(batchSize),
        ),
      );
      const deleted = result.rowCount ?? 0;
      if (deleted === 0) break;
      deletedWindow += deleted;
      deletedTotal += deleted;
    }

    if (deletedWindow > 0) {
      await recordArchiveLog(
        "info",
        "flow.cleanup.complete",
        `Deleted ${deletedWindow} original flow row(s) after the 1-day archive retention period; archive files were kept`,
        `${window.periodStart.toISOString()} – ${window.periodEnd.toISOString()}`,
      );
      logger.info(
        {
          deleted: deletedWindow,
          periodStart: window.periodStart,
          periodEnd: window.periodEnd,
          latestArchiveAt: window.latestArchiveAt,
        },
        "Deleted original flow rows after archive retention",
      );
    }
  }

  return deletedTotal;
}
