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

// IST wall-clock date (YYYY-MM-DD) and time (HHMM) of a window boundary, used to
// build human-readable per-NAS archive filenames that match the IST windows.
function istDateTimeStamp(windowStartMs: number): { date: string; time: string } {
  const iso = new Date(windowStartMs + IST_OFFSET_MS).toISOString();
  return { date: iso.slice(0, 10), time: iso.slice(11, 16).replace(":", "") };
}

function sanitizeNasName(name: string): string {
  return name.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") || "nas";
}

// `<NasName>_<NasIp>_<YYYY-MM-DD>_<HHMM>IST.json.gz`
function archiveFileName(
  nasName: string,
  nasIp: string,
  windowStartMs: number,
): string {
  const { date, time } = istDateTimeStamp(windowStartMs);
  return `${sanitizeNasName(nasName)}_${nasIp}_${date}_${time}IST.json.gz`;
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

// Live progress of the in-process compression run, surfaced to the UI so the
// operator can see which window is being compressed and roughly how long the
// backlog will take. Progress is measured by how far through the backlog's time
// span we've advanced (empty windows are skipped instantly), not by window
// count, so the ETA stays meaningful even with sparse data.
interface CompressionProgressState {
  running: boolean;
  startedAtMs: number | null;
  finishedAtMs: number | null;
  // Time span of the backlog captured when the run starts.
  backlogStartMs: number | null; // end_time of the earliest unarchived record
  backlogEndMs: number | null; // start of the current (still-open) window
  processedUptoMs: number | null; // end of the most recently archived window
  completedCount: number;
  currentFileName: string | null;
  currentPeriodStartMs: number | null;
  currentPeriodEndMs: number | null;
  lastError: string | null;
}

const compressionProgress: CompressionProgressState = {
  running: false,
  startedAtMs: null,
  finishedAtMs: null,
  backlogStartMs: null,
  backlogEndMs: null,
  processedUptoMs: null,
  completedCount: 0,
  currentFileName: null,
  currentPeriodStartMs: null,
  currentPeriodEndMs: null,
  lastError: null,
};

export interface CompressionStatus {
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  currentFileName: string | null;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  completedCount: number;
  progressPercent: number | null;
  elapsedSeconds: number | null;
  etaSeconds: number | null;
  lastError: string | null;
}

// Snapshot the current progress, computing elapsed/percent/ETA on read.
export function getCompressionStatus(): CompressionStatus {
  const p = compressionProgress;
  const now = Date.now();

  let progressPercent: number | null = null;
  let etaSeconds: number | null = null;
  let elapsedSeconds: number | null = null;

  if (p.startedAtMs != null) {
    const endRef = p.running ? now : (p.finishedAtMs ?? now);
    elapsedSeconds = Math.max(0, Math.round((endRef - p.startedAtMs) / 1000));
  }

  if (
    p.backlogStartMs != null &&
    p.backlogEndMs != null &&
    p.backlogEndMs > p.backlogStartMs
  ) {
    const processed = p.processedUptoMs ?? p.backlogStartMs;
    const frac = Math.min(
      1,
      Math.max(0, (processed - p.backlogStartMs) / (p.backlogEndMs - p.backlogStartMs)),
    );
    progressPercent = Math.round(frac * 1000) / 10;
    if (p.running && elapsedSeconds != null && frac > 0.005) {
      etaSeconds = Math.max(0, Math.round((elapsedSeconds * (1 - frac)) / frac));
    }
  }

  return {
    running: p.running,
    startedAt: p.startedAtMs != null ? new Date(p.startedAtMs).toISOString() : null,
    finishedAt: p.finishedAtMs != null ? new Date(p.finishedAtMs).toISOString() : null,
    currentFileName: p.currentFileName,
    currentPeriodStart:
      p.currentPeriodStartMs != null ? new Date(p.currentPeriodStartMs).toISOString() : null,
    currentPeriodEnd:
      p.currentPeriodEndMs != null ? new Date(p.currentPeriodEndMs).toISOString() : null,
    completedCount: p.completedCount,
    progressPercent,
    elapsedSeconds,
    etaSeconds,
    lastError: p.lastError,
  };
}

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
  // Reset progress for this run.
  compressionProgress.running = true;
  compressionProgress.startedAtMs = Date.now();
  compressionProgress.finishedAtMs = null;
  compressionProgress.backlogStartMs = null;
  compressionProgress.backlogEndMs = null;
  compressionProgress.processedUptoMs = null;
  compressionProgress.completedCount = 0;
  compressionProgress.currentFileName = null;
  compressionProgress.currentPeriodStartMs = null;
  compressionProgress.currentPeriodEndMs = null;
  compressionProgress.lastError = null;
  try {
    return await compressBacklog();
  } catch (err) {
    compressionProgress.lastError = err instanceof Error ? err.message : String(err);
    throw err;
  } finally {
    compressionRunning = false;
    compressionProgress.running = false;
    compressionProgress.finishedAtMs = Date.now();
    compressionProgress.currentFileName = null;
    compressionProgress.currentPeriodStartMs = null;
    compressionProgress.currentPeriodEndMs = null;
  }
}

async function compressBacklog(): Promise<CompressionResult[]> {
  const now = Date.now();
  // Start of the current, still-in-progress window. Any record ending before
  // this belongs to a window that has fully elapsed and is safe to archive.
  const currentWindowStart = new Date(windowStartUtcMs(now));
  const results: CompressionResult[] = [];
  // Upper bound of the backlog's time span for progress reporting; the lower
  // bound (earliest unarchived record) is captured on the first iteration.
  compressionProgress.backlogEndMs = currentWindowStart.getTime();

  // NAS name/IP for filenames. Loaded once per run; a NAS added mid-run falls
  // back to a synthetic name and is corrected on the next run.
  const nasRows = await db
    .select({
      id: nasDevicesTable.id,
      name: nasDevicesTable.name,
      ipAddress: nasDevicesTable.ipAddress,
    })
    .from(nasDevicesTable);
  const nasMap = new Map(nasRows.map((n) => [n.id, n]));

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

    // Capture the backlog's lower bound the first time we find work, so the
    // progress fraction has a stable denominator for the whole run.
    if (compressionProgress.backlogStartMs == null) {
      compressionProgress.backlogStartMs = earliest.endTime.getTime();
    }

    const windowStartMs = windowStartUtcMs(earliest.endTime.getTime());
    const windowEndMs = windowStartMs + ARCHIVE_WINDOW_MS;
    // The oldest remaining window is still inside its post-close grace, so every
    // remaining (newer) window is too — nothing else is ready yet.
    if (windowEndMs + ARCHIVE_GRACE_MS > now) break;

    const periodStart = new Date(windowStartMs);
    const periodEnd = new Date(windowEndMs);

    // Publish which window is being worked on right now (per-file name is set as
    // each NAS file within the window is compressed, below).
    compressionProgress.currentPeriodStartMs = windowStartMs;
    compressionProgress.currentPeriodEndMs = windowEndMs;

    const windowResults = await db.transaction(async (tx) => {
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

      // One archive file per NAS within this window, so each file carries a
      // single NAS's records under a filename with that NAS's name, IP and the
      // window's IST date/time. All files + the archived flag still commit in
      // this one transaction over the frozen row set.
      const byNas = new Map<number, typeof windowRows>();
      for (const r of windowRows) {
        const arr = byNas.get(r.nasId);
        if (arr) arr.push(r);
        else byNas.set(r.nasId, [r]);
      }

      const created: CompressionResult[] = [];
      const archivedIds: number[] = [];

      for (const [nasId, rows] of byNas) {
        const nas = nasMap.get(nasId);
        const nasName = nas?.name ?? `nas-${nasId}`;
        const nasIp = nas?.ipAddress ?? "unknown";
        const fileName = archiveFileName(nasName, nasIp, windowStartMs);
        compressionProgress.currentFileName = fileName;

        const serialized = JSON.stringify(rows);
        const originalBytes = Buffer.byteLength(serialized, "utf8");
        const compressed = gzipSync(serialized);
        const compressedBytes = compressed.length;

        const [archive] = await tx
          .insert(flowArchivesTable)
          .values({
            fileName,
            nasId,
            nasName,
            nasIp,
            recordCount: rows.length,
            originalBytes,
            compressedBytes,
            payload: compressed.toString("base64"),
            periodStart,
            periodEnd,
          })
          .returning();

        for (const r of rows) archivedIds.push(r.id);

        logger.info(
          { fileName, nasId, records: rows.length, compressedBytes },
          "Compressed flow records",
        );

        created.push({
          id: archive!.id,
          fileName: archive!.fileName,
          recordCount: archive!.recordCount,
          originalBytes: archive!.originalBytes,
          compressedBytes: archive!.compressedBytes,
          periodStart: archive!.periodStart,
          periodEnd: archive!.periodEnd,
          createdAt: archive!.createdAt,
        } satisfies CompressionResult);
      }

      // Mark exactly the frozen set we just gzipped. Marking must target the
      // precise ids we read — NOT a predicate like `archived=0 AND end_time in
      // window AND id<=maxId`: under READ COMMITTED a late record that obtained
      // its (lower) serial id before our SELECT but commits between that SELECT
      // and this UPDATE would match such a predicate and be flagged archived
      // without ever being written to a payload — silently dropping an IPDR
      // record. But a single `inArray` over every id overflows Drizzle's SQL
      // builder (RangeError: Maximum call stack size exceeded) and exceeds
      // Postgres's 65535-parameter-per-statement limit at production scale
      // (hundreds of thousands of rows per window). So we mark the exact ids in
      // bounded chunks, all within this same transaction, so the archive inserts
      // and every flag update still commit atomically over the frozen set.
      const MARK_CHUNK = 1000;
      for (let i = 0; i < archivedIds.length; i += MARK_CHUNK) {
        const chunk = archivedIds.slice(i, i + MARK_CHUNK);
        await tx
          .update(flowRecordsTable)
          .set({ archived: 1 })
          .where(inArray(flowRecordsTable.id, chunk));
      }

      return created;
    });

    // Window emptied out between the scan and the transaction (a concurrent run
    // grabbed it). Stop here; any remaining work is picked up on the next run.
    if (!windowResults) break;
    results.push(...windowResults);

    // Advance progress to the end of the window we just archived.
    compressionProgress.processedUptoMs = windowEndMs;
    compressionProgress.completedCount += windowResults.length;
  }

  return results;
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
