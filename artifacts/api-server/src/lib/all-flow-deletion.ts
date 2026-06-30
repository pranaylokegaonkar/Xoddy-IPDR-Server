import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import { db, flowRecordsTable } from "@workspace/db";
import { logger } from "./logger";

// Global "free the hot table" purge: delete every already-archived row from
// flow_records across all NAS devices. Each archived row has a durable gzip copy
// in flow_archives (downloadable on the Archives page), so this loses no IPDR
// data — it only reclaims the redundant hot-table copy. Not-yet-compressed
// (unarchived) rows are deliberately left for the compression job; deleting them
// would permanently lose records that have no archive copy yet.
//
// This can be millions of rows, so — like the per-NAS deletion and the
// compression job — it must run in the background in bounded batches, never
// synchronously in the request (a large DELETE would outlast the reverse-proxy
// timeout and surface as a 504).

interface AllDeletionState {
  running: boolean;
  startedAtMs: number;
  finishedAtMs: number | null;
  totalCount: number;
  deletedCount: number;
  lastError: string | null;
}

// Single global run at a time. A null state means no run has happened this
// server session (the UI shows no banner).
let state: AllDeletionState | null = null;

const BATCH_SIZE = 10000;

export interface AllFlowDeletionStatus {
  running: boolean;
  started: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  totalCount: number;
  deletedCount: number;
  progressPercent: number | null;
  elapsedSeconds: number | null;
  etaSeconds: number | null;
  lastError: string | null;
}

// Fire-and-forget. Returns `true` if a new run started, or `false` if one is
// already in flight (guards against an impatient double-click launching two
// passes). The client polls getAllFlowDeletionStatus either way.
export function startAllFlowDeletion(): boolean {
  if (state?.running) return false;

  const s: AllDeletionState = {
    running: true,
    startedAtMs: Date.now(),
    finishedAtMs: null,
    totalCount: 0,
    deletedCount: 0,
    lastError: null,
  };
  state = s;

  void runDeletion(s).catch((err) => {
    s.lastError = err instanceof Error ? err.message : String(err);
    s.running = false;
    s.finishedAtMs = Date.now();
    logger.error({ err }, "Global archived-flow deletion failed");
  });
  return true;
}

async function runDeletion(s: AllDeletionState): Promise<void> {
  try {
    const conds = (extra?: ReturnType<typeof lte>) => {
      const c = [eq(flowRecordsTable.archived, 1)];
      if (extra) c.push(extra);
      return and(...c);
    };

    // Snapshot the work by capturing the highest archived id at start; we only
    // ever delete `id <= cutoffId`. Records keep arriving (as archived=0) and
    // the compression job may mark more rows archived during the run — bounding
    // to the start cutoff keeps the loop terminating and deterministic. Any row
    // we do delete is archived, so its durable copy exists regardless.
    const [maxRow] = await db
      .select({ id: flowRecordsTable.id })
      .from(flowRecordsTable)
      .where(conds())
      .orderBy(desc(flowRecordsTable.id))
      .limit(1);
    const cutoffId = maxRow?.id ?? null;
    if (cutoffId == null) {
      s.totalCount = 0;
      return;
    }

    const [countRow] = await db
      .select({ count: sql<number>`cast(count(*) as int)` })
      .from(flowRecordsTable)
      .where(conds(lte(flowRecordsTable.id, cutoffId)));
    s.totalCount = countRow?.count ?? 0;

    // Delete via `id IN (SELECT id … LIMIT n)` rather than reading a page of ids
    // and passing them to `inArray`: a batch of tens of thousands of ids
    // overflows Drizzle's SQL builder (RangeError: Maximum call stack size
    // exceeded) and exceeds Postgres's 65535-parameter limit. The subquery sends
    // no id list, and `rowCount` tells us how many rows the batch actually removed.
    for (;;) {
      const result = await db.delete(flowRecordsTable).where(
        inArray(
          flowRecordsTable.id,
          db
            .select({ id: flowRecordsTable.id })
            .from(flowRecordsTable)
            .where(conds(lte(flowRecordsTable.id, cutoffId)))
            .limit(BATCH_SIZE),
        ),
      );
      const deleted = result.rowCount ?? 0;
      if (deleted === 0) break;
      s.deletedCount += deleted;
    }

    logger.info(
      { deleted: s.deletedCount },
      "Deleted all archived flow records (global purge)",
    );
  } finally {
    s.running = false;
    s.finishedAtMs = Date.now();
  }
}

// Snapshot progress, computing elapsed/percent/ETA on read. Returns an idle
// default when no run has ever started this session.
export function getAllFlowDeletionStatus(): AllFlowDeletionStatus {
  const s = state;
  if (!s) {
    return {
      running: false,
      started: false,
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
    progressPercent = 100;
  }

  return {
    running: s.running,
    started: true,
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
