import { gzipSync } from "node:zlib";
import { and, eq, lt, lte, gte, isNotNull, inArray } from "drizzle-orm";
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
let compressionRunning = false;

// Public entry point: serialize compression runs within this process so an
// impatient double-click on "Compress Now", or an overlap with the scheduled
// 2h job, can't launch two heavy backlog passes at once (which would duplicate
// archives and waste DB/CPU). Single service process, so an in-process flag is
// sufficient.
export async function runCompression(): Promise<CompressionResult[]> {
  if (compressionRunning) {
    logger.info("Compression already in progress; skipping overlapping run");
    return [];
  }
  compressionRunning = true;
  try {
    return await compressBacklog();
  } finally {
    compressionRunning = false;
  }
}

async function compressBacklog(): Promise<CompressionResult[]> {
  const now = Date.now();
  // Start of the current, still-in-progress window. Any record ending before
  // this belongs to a window that has fully elapsed and is safe to archive.
  const currentWindowStart = new Date(windowStartUtcMs(now));
  const results: CompressionResult[] = [];

  // Process one fully-elapsed window per transaction, oldest first. This keeps a
  // large first-time backlog from (a) loading every unarchived record into
  // memory at once and (b) holding a single long-running transaction — either of
  // which can exhaust memory or exceed a reverse-proxy timeout. Each window's
  // payload + archived flag are still committed atomically over a frozen row set.
  for (;;) {
    const [earliest] = await db
      .select({ endTime: flowRecordsTable.endTime })
      .from(flowRecordsTable)
      .where(
        and(
          eq(flowRecordsTable.archived, 0),
          lt(flowRecordsTable.endTime, currentWindowStart),
        ),
      )
      .orderBy(flowRecordsTable.endTime)
      .limit(1);

    if (!earliest) break;

    const windowStartMs = windowStartUtcMs(earliest.endTime.getTime());
    const windowEndMs = windowStartMs + ARCHIVE_WINDOW_MS;
    // The oldest remaining window is still inside its post-close grace, so every
    // remaining (newer) window is too — nothing else is ready yet.
    if (windowEndMs + ARCHIVE_GRACE_MS > now) break;

    const periodStart = new Date(windowStartMs);
    const periodEnd = new Date(windowEndMs);

    const result = await db.transaction(async (tx) => {
      // Re-select the window's rows inside the transaction so the payload and the
      // rows we mark archived always match, even if new eligible rows arrive
      // concurrently. A late record that lands after this read stays unarchived
      // and produces a second (harmless) archive on a later run — never dropped.
      const windowRows = await tx
        .select()
        .from(flowRecordsTable)
        .where(
          and(
            eq(flowRecordsTable.archived, 0),
            gte(flowRecordsTable.endTime, periodStart),
            lt(flowRecordsTable.endTime, periodEnd),
          ),
        );

      if (windowRows.length === 0) return null;

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

      return {
        id: archive!.id,
        fileName: archive!.fileName,
        recordCount: archive!.recordCount,
        originalBytes: archive!.originalBytes,
        compressedBytes: archive!.compressedBytes,
        periodStart: archive!.periodStart,
        periodEnd: archive!.periodEnd,
        createdAt: archive!.createdAt,
      } satisfies CompressionResult;
    });

    // Window emptied out between the scan and the transaction (a concurrent run
    // grabbed it). Stop here; any remaining work is picked up on the next run.
    if (!result) break;
    results.push(result);
  }

  return results;
}

// Fast check used by the manual "compress now" trigger: is there at least one
// fully-elapsed (past-grace) window with unarchived records ready to compress?
export async function hasReadyWindow(): Promise<boolean> {
  const now = Date.now();
  const currentWindowStart = new Date(windowStartUtcMs(now));
  const [earliest] = await db
    .select({ endTime: flowRecordsTable.endTime })
    .from(flowRecordsTable)
    .where(
      and(
        eq(flowRecordsTable.archived, 0),
        lt(flowRecordsTable.endTime, currentWindowStart),
      ),
    )
    .orderBy(flowRecordsTable.endTime)
    .limit(1);

  if (!earliest) return false;
  const windowEndMs = windowStartUtcMs(earliest.endTime.getTime()) + ARCHIVE_WINDOW_MS;
  return windowEndMs + ARCHIVE_GRACE_MS <= now;
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
