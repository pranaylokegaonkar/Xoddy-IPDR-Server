import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { db, flowRecordsTable } from "@workspace/db";
import { logger } from "./logger";

// Deleting a NAS's unarchived flow records can mean removing millions of rows
// (one device showed ~5.8M). A synchronous DELETE would outlast the reverse-proxy
// request timeout (the same 504 risk the compression job avoids), so we run it in
// the background in bounded batches and expose live progress for the UI to poll.

export type NasFlowDeletionScope = "unarchived" | "all";

interface NasDeletionState {
  nasId: number;
  nasName: string;
  scope: NasFlowDeletionScope;
  running: boolean;
  startedAtMs: number;
  finishedAtMs: number | null;
  totalCount: number;
  deletedCount: number;
  lastError: string | null;
}

// Keyed by nasId so independent NAS deletions can run/poll concurrently. A
// single service process, so an in-process map is sufficient.
const deletions = new Map<number, NasDeletionState>();

const BATCH_SIZE = 10000;

export interface NasFlowDeletionStatus {
  nasId: number;
  running: boolean;
  scope: NasFlowDeletionScope;
  startedAt: string | null;
  finishedAt: string | null;
  totalCount: number;
  deletedCount: number;
  progressPercent: number | null;
  elapsedSeconds: number | null;
  etaSeconds: number | null;
  lastError: string | null;
}

// Fire-and-forget. Returns `true` if a new deletion was started, or `false` if
// one for this NAS is already running (an impatient double-click can't launch two
// passes at once). The route uses this so its audit log + response reflect whether
// a job was actually started. The client polls getNasFlowDeletionStatus either way.
export function startNasFlowDeletion(
  nasId: number,
  nasName: string,
  scope: NasFlowDeletionScope = "unarchived",
): boolean {
  const existing = deletions.get(nasId);
  if (existing?.running) return false;

  const state: NasDeletionState = {
    nasId,
    nasName,
    scope,
    running: true,
    startedAtMs: Date.now(),
    finishedAtMs: null,
    totalCount: 0,
    deletedCount: 0,
    lastError: null,
  };
  deletions.set(nasId, state);

  void runDeletion(state).catch((err) => {
    state.lastError = err instanceof Error ? err.message : String(err);
    state.running = false;
    state.finishedAtMs = Date.now();
    logger.error({ err, nasId }, "NAS flow deletion failed");
  });
  return true;
}

async function runDeletion(state: NasDeletionState): Promise<void> {
  try {
    // The set of rows in scope. For "all" we delete every record for the NAS
    // (archived + unarchived); for "unarchived" we keep already-compressed rows.
    // Deleting archived rows is safe: compression stores a durable gzip copy in
    // `flow_archives` (downloadable on the Archives page), so the archived rows in
    // `flow_records` are a redundant hot-table copy — purging them frees the table
    // without losing IPDR data.
    const scopeConds = (extra?: ReturnType<typeof lte>) => {
      const conds = [eq(flowRecordsTable.nasId, state.nasId)];
      if (state.scope === "unarchived") {
        conds.push(eq(flowRecordsTable.archived, 0));
      }
      if (extra) conds.push(extra);
      return and(...conds);
    };

    // Snapshot the work at start by capturing the highest in-scope id for this
    // NAS. We only ever delete `id <= cutoffId`. This is essential for an IPDR
    // collector: records keep arriving during the delete, and without a cutoff the
    // loop would keep picking up post-start arrivals — never terminating AND
    // silently destroying live records we were never asked to delete. `id` is a
    // monotonic serial, so any record inserted after this point has a larger id
    // and is safe.
    const [maxRow] = await db
      .select({ id: flowRecordsTable.id })
      .from(flowRecordsTable)
      .where(scopeConds())
      .orderBy(desc(flowRecordsTable.id))
      .limit(1);
    const cutoffId = maxRow?.id ?? null;
    if (cutoffId == null) {
      state.totalCount = 0;
      return;
    }

    const [countRow] = await db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(flowRecordsTable)
      .where(scopeConds(lte(flowRecordsTable.id, cutoffId)));
    state.totalCount = countRow?.count ?? 0;

    // Delete in bounded batches: grab a page of ids within the snapshot, delete
    // exactly those, repeat until none remain. Bounds memory and per-statement
    // time, and keeps progress (deletedCount) advancing for the UI.
    for (;;) {
      const batch = await db
        .select({ id: flowRecordsTable.id })
        .from(flowRecordsTable)
        .where(scopeConds(lte(flowRecordsTable.id, cutoffId)))
        .limit(BATCH_SIZE);
      if (batch.length === 0) break;

      const ids = batch.map((b) => b.id);
      await db.delete(flowRecordsTable).where(inArray(flowRecordsTable.id, ids));
      state.deletedCount += ids.length;
    }

    logger.info(
      { nasId: state.nasId, scope: state.scope, deleted: state.deletedCount },
      "Deleted flow records for NAS",
    );
  } finally {
    state.running = false;
    state.finishedAtMs = Date.now();
  }
}

// Snapshot progress, computing elapsed/percent/ETA on read. Returns an idle
// default when no deletion has ever been started for this NAS.
export function getNasFlowDeletionStatus(nasId: number): NasFlowDeletionStatus {
  const s = deletions.get(nasId);
  if (!s) {
    return {
      nasId,
      running: false,
      scope: "unarchived",
      startedAt: null,
      finishedAt: null,
      totalCount: 0,
      deletedCount: 0,
      progressPercent: null,
      elapsedSeconds: null,
      etaSeconds: null,
      lastError: null,
    };
  }

  const now = Date.now();
  const endRef = s.running ? now : (s.finishedAtMs ?? now);
  const elapsedSeconds = Math.max(0, Math.round((endRef - s.startedAtMs) / 1000));

  let progressPercent: number | null = null;
  let etaSeconds: number | null = null;
  if (s.totalCount > 0) {
    const frac = Math.min(1, s.deletedCount / s.totalCount);
    progressPercent = Math.round(frac * 1000) / 10;
    if (s.running && frac > 0.005) {
      etaSeconds = Math.max(0, Math.round((elapsedSeconds * (1 - frac)) / frac));
    }
  } else if (!s.running) {
    // Finished with nothing to delete.
    progressPercent = 100;
  }

  return {
    nasId: s.nasId,
    running: s.running,
    scope: s.scope,
    startedAt: new Date(s.startedAtMs).toISOString(),
    finishedAt: s.finishedAtMs != null ? new Date(s.finishedAtMs).toISOString() : null,
    totalCount: s.totalCount,
    deletedCount: s.deletedCount,
    progressPercent,
    elapsedSeconds,
    etaSeconds,
    lastError: s.lastError,
  };
}
