import { gzipSync } from "node:zlib";
import { and, eq, lte, isNotNull, inArray } from "drizzle-orm";
import {
  db,
  flowRecordsTable,
  flowArchivesTable,
  nasDevicesTable,
  notificationsTable,
} from "@workspace/db";
import { logger } from "./logger";

const COMPRESSION_INTERVAL_MS = 1000 * 60 * 60 * 2;
const NOTIFY_INTERVAL_MS = 1000 * 60 * 15;
const STALE_WINDOW_MS = 1000 * 60 * 60;

export interface CompressionResult {
  fileName: string;
  recordCount: number;
  originalBytes: number;
  compressedBytes: number;
  periodStart: Date;
  periodEnd: Date;
  createdAt: Date;
  id: number;
}

// Compress flow records older than 2 hours into a gzipped batch, then mark
// them archived. Returns the created archive row, or null when nothing to do.
export async function runCompression(): Promise<CompressionResult | null> {
  const cutoff = new Date(Date.now() - COMPRESSION_INTERVAL_MS);

  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(flowRecordsTable)
      .where(
        and(
          eq(flowRecordsTable.archived, 0),
          lte(flowRecordsTable.endTime, cutoff),
        ),
      );

    if (rows.length === 0) return null;

    // Freeze the exact set of rows so the archive payload and the rows we mark
    // archived always match, even if new eligible rows arrive concurrently.
    const ids = rows.map((r) => r.id);
    const serialized = JSON.stringify(rows);
    const originalBytes = Buffer.byteLength(serialized, "utf8");
    const compressed = gzipSync(serialized);
    const compressedBytes = compressed.length;

    let periodStart = rows[0]!.startTime;
    let periodEnd = rows[0]!.endTime;
    for (const r of rows) {
      if (r.startTime < periodStart) periodStart = r.startTime;
      if (r.endTime > periodEnd) periodEnd = r.endTime;
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const fileName = `ipdr-${stamp}.json.gz`;

    const [archive] = await tx
      .insert(flowArchivesTable)
      .values({
        fileName,
        recordCount: rows.length,
        originalBytes,
        compressedBytes,
        payload: compressed.toString("base64"),
        periodStart,
        periodEnd,
      })
      .returning();

    await tx
      .update(flowRecordsTable)
      .set({ archived: 1 })
      .where(inArray(flowRecordsTable.id, ids));

    logger.info(
      { fileName, records: rows.length, compressedBytes },
      "Compressed flow records",
    );

    return {
      id: archive!.id,
      fileName: archive!.fileName,
      recordCount: archive!.recordCount,
      originalBytes: archive!.originalBytes,
      compressedBytes: archive!.compressedBytes,
      periodStart: archive!.periodStart,
      periodEnd: archive!.periodEnd,
      createdAt: archive!.createdAt,
    };
  });
}

// Check each enabled NAS: if it has been seen before but has produced no
// records recently, raise a "no_records" notification (deduplicated).
export async function checkRecordGeneration(): Promise<void> {
  const staleCutoff = new Date(Date.now() - STALE_WINDOW_MS);
  const enabled = await db
    .select()
    .from(nasDevicesTable)
    .where(
      and(
        eq(nasDevicesTable.enabled, true),
        isNotNull(nasDevicesTable.lastSeenAt),
        lte(nasDevicesTable.lastSeenAt, staleCutoff),
      ),
    );

  for (const nas of enabled) {
    const [existing] = await db
      .select({ id: notificationsTable.id })
      .from(notificationsTable)
      .where(
        and(
          eq(notificationsTable.type, "no_records"),
          eq(notificationsTable.nasId, nas.id),
          eq(notificationsTable.read, false),
        ),
      );
    if (existing) continue;

    await db.insert(notificationsTable).values({
      type: "no_records",
      severity: "warning",
      title: `No records from ${nas.name}`,
      message: `NAS "${nas.name}" (${nas.ipAddress}) has not generated any flow records for over an hour. Verify the router's traffic-flow target configuration.`,
      nasId: nas.id,
    });
    logger.warn({ nasId: nas.id }, "Raised no_records notification");
  }
}

export function startJobs(): void {
  setInterval(() => {
    void runCompression().catch((err) =>
      logger.error({ err }, "Compression job failed"),
    );
  }, COMPRESSION_INTERVAL_MS);

  setInterval(() => {
    void checkRecordGeneration().catch((err) =>
      logger.error({ err }, "Record-generation check failed"),
    );
  }, NOTIFY_INTERVAL_MS);

  logger.info("Background jobs scheduled (compression 2h, notify 15m)");
}
