import { gzipSync } from "node:zlib";
import { and, eq, lt, lte, isNotNull, inArray } from "drizzle-orm";
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

// Archives are bucketed into fixed 2-hour windows aligned to the IST wall clock
// (00:00–02:00, 02:00–04:00, … IST). Records are grouped by the window their
// end time falls into; only fully-elapsed windows are archived.
const ARCHIVE_WINDOW_MS = 1000 * 60 * 60 * 2;
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
// Wait this long after a window closes before archiving it, so flow exports that
// trail the flow's actual end (NetFlow active/inactive timeouts) have time to
// land. Avoids prematurely archiving a window and then having to create a second
// archive for the same window when a late record arrives.
const ARCHIVE_GRACE_MS = 1000 * 60 * 15;

// Start (in UTC epoch ms) of the IST 2-hour window that the given instant
// belongs to. Because IST midnight is the alignment origin and 2h divides 24h
// evenly, every boundary lands on an even IST hour (00:00, 02:00, …, 22:00).
function windowStartUtcMs(tsMs: number): number {
  const istMs = tsMs + IST_OFFSET_MS;
  const flooredIstMs = Math.floor(istMs / ARCHIVE_WINDOW_MS) * ARCHIVE_WINDOW_MS;
  return flooredIstMs - IST_OFFSET_MS;
}

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

// Compress unarchived flow records into gzipped batches, one per fully-elapsed
// IST 2-hour window (00:00–02:00, 02:00–04:00, … IST), grouping each record by
// the window its end time falls into. The in-progress window is left untouched
// until it completes. Returns every archive created (newest window last), or an
// empty array when there is nothing to compress.
export async function runCompression(): Promise<CompressionResult[]> {
  const now = Date.now();
  // Start of the current, still-in-progress window. Any record ending before
  // this belongs to a window that has fully elapsed and is safe to archive.
  const currentWindowStart = new Date(windowStartUtcMs(now));

  return db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(flowRecordsTable)
      .where(
        and(
          eq(flowRecordsTable.archived, 0),
          lt(flowRecordsTable.endTime, currentWindowStart),
        ),
      );

    if (rows.length === 0) return [];

    // Bucket records by the IST window their end time falls into.
    const buckets = new Map<number, typeof rows>();
    for (const r of rows) {
      const key = windowStartUtcMs(r.endTime.getTime());
      const bucket = buckets.get(key);
      if (bucket) bucket.push(r);
      else buckets.set(key, [r]);
    }

    const results: CompressionResult[] = [];

    // Process windows in chronological order so the newest is returned last.
    for (const windowStartMs of [...buckets.keys()].sort((a, b) => a - b)) {
      const windowEndMs = windowStartMs + ARCHIVE_WINDOW_MS;
      // Defer a just-closed window until late-trailing exports have had time to
      // arrive, so we don't archive it twice.
      if (windowEndMs + ARCHIVE_GRACE_MS > now) continue;

      const windowRows = buckets.get(windowStartMs)!;
      const periodStart = new Date(windowStartMs);
      const periodEnd = new Date(windowEndMs);

      // Freeze the exact set of rows so the archive payload and the rows we mark
      // archived always match, even if new eligible rows arrive concurrently.
      const ids = windowRows.map((r) => r.id);
      const serialized = JSON.stringify(windowRows);
      const originalBytes = Buffer.byteLength(serialized, "utf8");
      const compressed = gzipSync(serialized);
      const compressedBytes = compressed.length;

      const stamp = periodStart.toISOString().replace(/[:.]/g, "-");
      const fileName = `ipdr-${stamp}.json.gz`;

      const [archive] = await tx
        .insert(flowArchivesTable)
        .values({
          fileName,
          recordCount: windowRows.length,
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
        { fileName, records: windowRows.length, compressedBytes },
        "Compressed flow records",
      );

      results.push({
        id: archive!.id,
        fileName: archive!.fileName,
        recordCount: archive!.recordCount,
        originalBytes: archive!.originalBytes,
        compressedBytes: archive!.compressedBytes,
        periodStart: archive!.periodStart,
        periodEnd: archive!.periodEnd,
        createdAt: archive!.createdAt,
      });
    }

    return results;
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
