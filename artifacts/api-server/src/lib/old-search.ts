import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, readdir, rm, statfs } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { createInterface } from "node:readline";
import { setImmediate as yieldToCollector } from "node:timers/promises";
import { and, desc, eq, inArray, isNotNull, lte, gt, sql } from "drizzle-orm";
import { db, pool, flowArchivesTable, nasDevicesTable } from "@workspace/db";
import type { ArchiveRangeInput, ArchiveWorkspaceInput, OldSearchSession, FlowSearch } from "@workspace/api-zod";
import { ARCHIVE_LOCK_NAMESPACE } from "./archive-locks";
import { consumeArchive, normalizeArchivedFlow, matchesArchivedFlow, type ArchivedFlow } from "./old-search-records";
import { streamArchiveFromShare } from "./archive-storage";
import { serializeArchive } from "./serializers";
import { logger } from "./logger";

export const WORKSPACE_BYTES = 512 * 1024 * 1024;
export const EXPORT_LIMIT = 50_000;
const MAX_RECORDS = 1_000_000;
const TTL = 30 * 60 * 1000;
const ROOT = path.join(os.tmpdir(), "xoddy-ipdr-old-search");
export class OldSearchError extends Error {
  constructor(message: string, public status = 400) { super(message); }
}
const connect = () => pool.connect();
type PoolClient = Awaited<ReturnType<typeof connect>>;
interface Workspace {
  status: OldSearchSession;
  owner: number;
  directory: string;
  client: PoolClient;
  abort: AbortController;
  preparing: Promise<void>;
  busy: boolean;
  closing: boolean;
  lockError: () => void;
  lostConnection: boolean;
}
const sessions = new Map<string, Workspace>();
const startingOwners = new Set<number>();
const active = (s: Workspace) => !s.closing && ["preparing", "ready"].includes(s.status.state);
const occupying = (s: Workspace) => active(s) || s.closing && !["released", "expired", "error"].includes(s.status.state);
const snapshot = (s: Workspace): OldSearchSession => ({ ...s.status, archiveIds: [...s.status.archiveIds] });

export function validateArchiveRange(input: ArchiveRangeInput) {
  const from = new Date(input.startAt), to = new Date(input.endAt);
  if (!Number.isFinite(from.getTime()) || !Number.isFinite(to.getTime()) || from > to)
    throw new OldSearchError("Provide valid start and end timestamps with start on or before end.");
  if (input.nasId !== undefined && (!Number.isInteger(input.nasId) || input.nasId < 1 || input.nasId > 2147483647))
    throw new OldSearchError("Invalid NAS device.");
  return { from, to };
}
function rangeWhere(input: ArchiveRangeInput) {
  const { from, to } = validateArchiveRange(input);
  return and(
    lte(flowArchivesTable.periodStart, to),
    gt(flowArchivesTable.periodEnd, from),
    // Null NAS means a legacy archive may bundle multiple devices.
    input.nasId === undefined ? undefined :
      sql`(${flowArchivesTable.nasId} = ${input.nasId} OR ${flowArchivesTable.nasId} IS NULL)`,
  );
}
const metadata = {
  id: flowArchivesTable.id, fileName: flowArchivesTable.fileName,
  nasId: flowArchivesTable.nasId, nasName: flowArchivesTable.nasName, nasIp: flowArchivesTable.nasIp,
  recordCount: flowArchivesTable.recordCount, originalBytes: flowArchivesTable.originalBytes,
  compressedBytes: flowArchivesTable.compressedBytes, periodStart: flowArchivesTable.periodStart,
  periodEnd: flowArchivesTable.periodEnd, createdAt: flowArchivesTable.createdAt,
};
export async function findOldArchives(input: ArchiveRangeInput) {
  const rows = await db.select(metadata).from(flowArchivesTable).where(rangeWhere(input))
    .orderBy(desc(flowArchivesTable.periodStart), desc(flowArchivesTable.id)).limit(501);
  if (rows.length > 500) throw new OldSearchError("More than 500 archives match. Narrow the date/time range or choose a NAS.");
  return rows.map(serializeArchive);
}
async function initializeTemporaryRoot() {
  await mkdir(ROOT, { recursive: true, mode: 0o700 });
  // Remove only this app's orphan directories whose owning process is gone.
  for (const item of await readdir(ROOT, { withFileTypes: true })) {
    const match = /^(\d+)-[a-f0-9-]+$/.exec(item.name);
    if (!item.isDirectory() || !match) continue;
    try { process.kill(Number(match[1]), 0); }
    catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ESRCH")
        await rm(path.join(ROOT, item.name), { recursive: true, force: true });
    }
  }
}
const initialized = initializeTemporaryRoot();
// Avoid an unhandled startup rejection; actual preparation reports the failure.
initialized.catch((err) => logger.error({ err }, "Old Search temporary directory unavailable"));
function touch(s: Workspace) { s.status.expiresAt = new Date(Date.now() + TTL); }
function getOwned(owner: number, id: string): Workspace {
  const s = sessions.get(id);
  if (!s || s.owner !== owner) throw new OldSearchError("Temporary workspace not found. It may have been removed after a server restart.", 404);
  return s;
}
export function listOldSessions(owner: number) {
  return [...sessions.values()].filter((s) => s.owner === owner)
    .sort((a, b) => b.status.createdAt.getTime() - a.status.createdAt.getTime()).slice(0, 10).map(snapshot);
}
export async function oldSessionStatus(owner: number, id: string) {
  const s = getOwned(owner, id);
  if (active(s) && s.status.expiresAt.getTime() <= Date.now() && !s.busy)
    await releaseOldSession(owner, id, "expired");
  return snapshot(s);
}
async function dispose(s: Workspace) {
  s.client.removeListener("error", s.lockError);
  // Destroy instead of returning a connection with session-level locks to pool.
  s.client.release(true);
  await rm(s.directory, { recursive: true, force: true });
}
export async function prepareOldSession(owner: number, input: ArchiveWorkspaceInput) {
  validateArchiveRange(input);
  const ids = [...new Set(input.archiveIds)].sort((a, b) => a - b);
  if (!ids.length || ids.length > 100 || ids.some((id) => !Number.isInteger(id) || id < 1 || id > 2147483647))
    throw new OldSearchError("Select between 1 and 100 valid archives.");
  if (startingOwners.has(owner) || [...sessions.values()].some((s) => s.owner === owner && occupying(s)))
    throw new OldSearchError("Release your existing temporary workspace first.", 409);
  if (startingOwners.size || [...sessions.values()].some((s) => active(s) && s.status.state === "preparing"))
    throw new OldSearchError("Another archive preparation is running. Please wait.", 409);
  if ([...sessions.values()].filter(occupying).length >= 2)
    throw new OldSearchError("Two temporary workspaces are already active. Release one or wait for expiry.", 429);
  startingOwners.add(owner);
  let client: PoolClient | undefined;
  let directory: string | undefined;
  let held = false;
  let earlyConnectionError: Error | null = null;
  const onEarlyError = (error: Error) => { earlyConnectionError = error; };
  try {
    await initialized;
    client = await pool.connect();
    client.on("error", onEarlyError);
    const locks = await client.query<{ locked: boolean }>(
      "SELECT pg_try_advisory_lock_shared($1::int, archive_id) AS locked FROM unnest($2::int[]) AS archive_id",
      [ARCHIVE_LOCK_NAMESPACE, ids],
    );
    if (locks.rows.some((r) => !r.locked))
      throw new OldSearchError("A selected archive is being deleted. Refresh the archive list and try again.", 409);
    const rows = await db.select(metadata).from(flowArchivesTable)
      .where(and(inArray(flowArchivesTable.id, ids), rangeWhere(input)))
      .orderBy(desc(flowArchivesTable.periodStart), desc(flowArchivesTable.id));
    if (rows.length !== ids.length) throw new OldSearchError("A selected archive no longer exists or is outside the chosen date/NAS range. Find archives again.", 409);
    const estimate = rows.reduce((n, r) => n + r.originalBytes, 0);
    const compressed = rows.reduce((n, r) => n + r.compressedBytes, 0);
    if (rows.reduce((n, r) => n + r.recordCount, 0) > MAX_RECORDS)
      throw new OldSearchError("Selection exceeds 1,000,000 source records. Prepare fewer archives.");
    if (estimate > WORKSPACE_BYTES || compressed > 128 * 1024 * 1024)
      throw new OldSearchError("Selection exceeds 512 MiB expanded or 128 MiB compressed. Prepare fewer archives.");
    const disk = await statfs(ROOT);
    if (disk.bavail * disk.bsize < WORKSPACE_BYTES + 1024 * 1024 * 1024)
      throw new OldSearchError("Not enough temporary disk space. At least 1.5 GiB free is required.", 409);
    const id = randomUUID();
    directory = path.join(ROOT, `${process.pid}-${id}`);
    await mkdir(directory, { mode: 0o700 });
    if (earlyConnectionError) throw new OldSearchError("Archive protection connection was lost. Please try again.", 503);
    const names = rows.some((row) => row.nasId === null)
      ? new Map((await db.select({ id: nasDevicesTable.id, name: nasDevicesTable.name }).from(nasDevicesTable)).map((r) => [r.id, r.name]))
      : new Map<number, string>();
    if (earlyConnectionError) throw new OldSearchError("Archive protection connection was lost. Please try again.", 503);
    const createdAt = new Date();
    const s: Workspace = {
      owner, client, directory, abort: new AbortController(), busy: false, closing: false,
      lostConnection: false, lockError: () => {},
      preparing: Promise.resolve(),
      status: {
        id, state: "preparing", archiveIds: ids, totalArchives: rows.length, processedArchives: 0,
        scannedRecords: 0, recordCount: 0, bytesWritten: 0, estimatedBytes: estimate, progressPercent: 0,
        expiresAt: new Date(Date.now() + TTL), error: null, createdAt,
        startAt: new Date(input.startAt), endAt: new Date(input.endAt),
        nasId: input.nasId ?? null, maxWorkspaceBytes: WORKSPACE_BYTES, exportLimit: EXPORT_LIMIT,
      },
    };
    s.lockError = () => {
      s.lostConnection = true;
      s.status.state = "error";
      s.status.error = "Archive protection connection was lost.";
      s.abort.abort(new Error("Archive protection connection was lost."));
      if (!s.busy)
        void releaseOldSession(owner, id, "error").catch((err) => logger.error({ err }, "Old Search connection-loss cleanup failed"));
    };
    client.removeListener("error", onEarlyError);
    client.on("error", s.lockError);
    sessions.set(id, s);
    held = true;
    // Begin after the HTTP handler has returned its accepted response.
    s.preparing = yieldToCollector().then(async () => {
      const file = await open(path.join(s.directory, "records.ndjson"), "wx", 0o600);
      const seen = new Set<number>();
      const sourceRecords = rows.reduce((n, r) => n + r.recordCount, 0);
      const from = s.status.startAt.getTime(), to = s.status.endAt.getTime();
      let batch = "", batchBytes = 0;
      async function flush() {
        if (!batch) return;
        await file.writeFile(batch);
        batch = ""; batchBytes = 0;
      }
      try {
        for (const archive of rows) {
          s.abort.signal.throwIfAborted();
          const [payload] = await db.select({
            payload: flowArchivesTable.payload, storageKey: flowArchivesTable.storageKey,
          }).from(flowArchivesTable).where(eq(flowArchivesTable.id, archive.id));
          if (!payload) throw new Error("A selected archive became unavailable.");
          const source = payload.payload !== null
            ? Readable.from([Buffer.from(payload.payload, "base64")])
            : payload.storageKey ? await streamArchiveFromShare(payload.storageKey) : null;
          if (!source) throw new Error("Archive content is unavailable.");
          let scannedArchive = 0;
          await consumeArchive(source, WORKSPACE_BYTES, s.abort.signal, async (value) => {
            const row = normalizeArchivedFlow(value, archive.nasName ?? `NAS ${archive.nasId ?? "legacy"}`);
            if (archive.nasId === null) row.nasName = names.get(row.nasId) ?? `NAS ${row.nasId}`;
            ++s.status.scannedRecords;
            ++scannedArchive;
            if (s.status.scannedRecords % 500 === 0)
              s.status.progressPercent = Math.min(99, Math.floor(s.status.scannedRecords / Math.max(1, sourceRecords) * 100));
            if (s.status.scannedRecords > MAX_RECORDS) throw new Error("Selection exceeds 1,000,000 source records. Prepare fewer archives.");
            const end = Date.parse(row.endTime);
            if (end < from || end > to || (input.nasId !== undefined && row.nasId !== input.nasId) || seen.has(row.id)) return;
            seen.add(row.id);
            const line = JSON.stringify(row) + "\n";
            const bytes = Buffer.byteLength(line);
            if (s.status.bytesWritten + bytes > WORKSPACE_BYTES) throw new Error("Temporary data exceeds 512 MiB. Prepare fewer archives.");
            s.status.bytesWritten += bytes;
            ++s.status.recordCount;
            batch += line; batchBytes += bytes;
            if (batchBytes >= 256 * 1024) await flush();
          });
          if (scannedArchive !== archive.recordCount) throw new Error("Archive record count does not match its metadata; preparation stopped.");
          ++s.status.processedArchives;
          s.status.progressPercent = Math.min(99, Math.floor(s.status.scannedRecords / Math.max(1, sourceRecords) * 100));
        }
        await flush();
        s.abort.signal.throwIfAborted();
        s.status.state = "ready";
        s.status.progressPercent = 100;
        touch(s);
      } finally { await file.close(); }
    }).catch(async (err: unknown) => {
      if (s.closing) return;
      logger.error({ err, workspaceId: id }, "Old Search preparation failed");
      s.status.state = "error";
      s.status.error = err instanceof Error ? err.message : "Archive preparation failed.";
      s.closing = true;
      await dispose(s);
    });
    // Cleanup is awaited above; guard cleanup errors from becoming unhandled.
    s.preparing.catch((err) => logger.error({ err }, "Old Search cleanup failed"));
    return snapshot(s);
  } catch (err) {
    if (!held) {
      client?.release(true);
      if (directory) await rm(directory, { recursive: true, force: true });
    }
    throw err;
  } finally { startingOwners.delete(owner); }
}
export async function releaseOldSession(owner: number, id: string, state: "released" | "expired" | "error" = "released") {
  const s = getOwned(owner, id);
  if (s.busy) throw new OldSearchError("A search or export is running. Wait for it to finish before releasing.", 409);
  if (s.closing) {
    if (["preparing", "ready"].includes(s.status.state))
      throw new OldSearchError("Workspace release is still in progress. Please wait for its status to update.", 409);
    return { released: true };
  }
  s.closing = true;
  s.abort.abort();
  await s.preparing;
  try { await dispose(s); }
  catch (err) {
    s.status.state = "error";
    s.status.error = "Temporary file cleanup failed. Original archives were not changed; check server logs.";
    logger.error({ err, workspaceId: id }, "Old Search release cleanup failed");
    throw err;
  }
  s.status.state = state;
  s.status.error = state === "error" ? "Archive protection was lost. Temporary data was removed; original archives were not changed." : null;
  s.status.bytesWritten = 0;
  return { released: true };
}
export function validateOldFilters(f: FlowSearch) {
  for (const key of ["dateFrom", "dateTo"] as const) {
    const value = f[key];
    if (value && (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value))
      throw new OldSearchError("Invalid filter date.");
  }
  for (const key of ["startTime", "endTime"] as const)
    if (f[key] && !/^([01]\d|2[0-3]):[0-5]\d$/.test(f[key]!)) throw new OldSearchError("Invalid filter time.");
  if (f.dateFrom && f.dateTo && f.dateFrom > f.dateTo) throw new OldSearchError("Start filter date must not be after end date.");
  if (f.nasId !== undefined && (!Number.isInteger(f.nasId) || f.nasId < 1 || f.nasId > 2147483647)) throw new OldSearchError("Invalid NAS filter.");
  if (f.page !== undefined && (!Number.isInteger(f.page) || f.page < 1 || f.page > 1_000_000)) throw new OldSearchError("Invalid page.");
  if (f.pageSize !== undefined && (!Number.isInteger(f.pageSize) || f.pageSize < 1 || f.pageSize > 200)) throw new OldSearchError("Invalid page size.");
}
/** Keeps workspace/locks alive through an operation, including sending exports. */
export async function useOldWorkspace<T>(owner: number, id: string, work: (s: Workspace) => Promise<T>) {
  await oldSessionStatus(owner, id);
  const s = getOwned(owner, id);
  if (s.closing || s.status.state !== "ready") throw new OldSearchError("Temporary workspace is not ready. Prepare it again if released, expired or interrupted.", 409);
  if (s.busy) throw new OldSearchError("Another search or export is running in this workspace.", 409);
  s.busy = true;
  touch(s);
  try { return await work(s); }
  finally {
    s.busy = false;
    touch(s);
    if (s.lostConnection && !s.closing) await releaseOldSession(owner, id, "error");
  }
}
export async function scanOldWorkspace(s: Workspace, filters: FlowSearch, exporting = false) {
  validateOldFilters(filters);
  const page = filters.page ?? 1, pageSize = filters.pageSize ?? 50;
  const rows: ArchivedFlow[] = [];
  const lines = createInterface({ input: createReadStream(path.join(s.directory, "records.ndjson")), crlfDelay: Infinity });
  let total = 0, scanned = 0;
  try {
    for await (const line of lines) {
      s.abort.signal.throwIfAborted();
      const row = JSON.parse(line) as ArchivedFlow;
      if (matchesArchivedFlow(row, filters)) {
        ++total;
        if (exporting) {
          if (total > EXPORT_LIMIT) throw new OldSearchError("More than 50,000 records match. Narrow the filters before exporting; no truncated export was produced.");
          rows.push(row);
        } else if (total > (page - 1) * pageSize && rows.length < pageSize) rows.push(row);
      }
      if (++scanned % 500 === 0) await yieldToCollector();
    }
    return { records: rows, total, page, pageSize };
  } finally { lines.close(); }
}
const sweeper = setInterval(() => {
  for (const s of sessions.values()) {
    if (active(s) && !s.busy && s.status.expiresAt.getTime() <= Date.now())
      void releaseOldSession(s.owner, s.status.id, "expired").catch((err) => logger.error({ err }, "Old Search expiry cleanup failed"));
    else if (!active(s) && s.status.expiresAt.getTime() < Date.now() - 60 * 60 * 1000) sessions.delete(s.status.id);
  }
}, 60_000);
sweeper.unref();
