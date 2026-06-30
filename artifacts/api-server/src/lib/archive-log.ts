import { db, archiveLogsTable } from "@workspace/db";
import { logger } from "./logger";

export type ArchiveLogLevel = "info" | "warning" | "error";

/**
 * Persist an archive/compression activity log entry so operators can review the
 * compression history (and any failures) on the Archive Logs page. Never throws
 * — logging must never break the compression job or the request that triggered
 * it.
 */
export async function recordArchiveLog(
  level: ArchiveLogLevel,
  event: string,
  message: string,
  detail?: string | null,
): Promise<void> {
  try {
    await db.insert(archiveLogsTable).values({
      level,
      event,
      message,
      detail: detail ?? null,
    });
  } catch (err) {
    logger.error({ err, event }, "Failed to record archive log");
  }
}
