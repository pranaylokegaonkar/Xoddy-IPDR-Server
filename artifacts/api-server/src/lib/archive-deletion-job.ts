import { randomUUID } from "node:crypto";

export interface ArchiveDeletionStatus {
  jobId: string | null;
  running: boolean;
  startedAt: string | null;
  finishedAt: string | null;
  totalCount: number;
  processedCount: number;
  deletedCount: number;
  missingCount: number;
  failedCount: number;
  cleanupFailedCount: number;
  progressPercent: number;
  elapsedSeconds: number;
  etaSeconds: number | null;
  currentFileName: string | null;
  lastError: string | null;
}

type DeleteResult = "deleted" | "missing" | "cleanup-failed";
interface Dependencies {
  deleteOne: (id: number, setFileName: (name: string) => void) => Promise<DeleteResult>;
  onError: (error: unknown, id?: number) => void;
  now?: () => number;
}

interface Job {
  status: ArchiveDeletionStatus;
  startedAtMs: number;
  finishedAtMs: number | null;
}

/** One bounded, explicitly selected id set at a time. No live-table sweep. */
export class ArchiveDeletionJob {
  private job: Job | null = null;
  private readonly now: () => number;

  constructor(private readonly dependencies: Dependencies) {
    this.now = dependencies.now ?? Date.now;
  }

  getStatus(): ArchiveDeletionStatus {
    const status = this.job?.status;
    const elapsed = this.job
      ? Math.max(0, ((this.job.finishedAtMs ?? this.now()) - this.job.startedAtMs) / 1000)
      : 0;
    const processed = status?.processedCount ?? 0;
    const remaining = (status?.totalCount ?? 0) - processed;
    return {
      jobId: status?.jobId ?? null,
      running: status?.running ?? false,
      startedAt: status?.startedAt ?? null,
      finishedAt: status?.finishedAt ?? null,
      totalCount: status?.totalCount ?? 0,
      processedCount: processed,
      deletedCount: status?.deletedCount ?? 0,
      missingCount: status?.missingCount ?? 0,
      failedCount: status?.failedCount ?? 0,
      cleanupFailedCount: status?.cleanupFailedCount ?? 0,
      progressPercent: status?.totalCount ? Math.floor(processed / status.totalCount * 100) : 0,
      elapsedSeconds: Math.floor(elapsed),
      // An estimate, not a promised countdown. A slow current archive can
      // increase the estimate; show "Calculating" until one item completes.
      etaSeconds: status?.running && processed > 0 && remaining > 0
        ? Math.max(1, Math.ceil(elapsed / processed * remaining))
        : null,
      currentFileName: status?.currentFileName ?? null,
      lastError: status?.lastError ?? null,
    };
  }

  start(
    selectedIds: readonly number[],
    onFinished?: (status: ArchiveDeletionStatus) => Promise<void>,
  ): { started: boolean; status: ArchiveDeletionStatus } {
    if (this.job?.status.running) return { started: false, status: this.getStatus() };
    // Copy and deduplicate before returning. Caller edits and newly created
    // archives can never expand the deletion's scope.
    const ids = [...new Set(selectedIds)];
    if (!ids.length || ids.length > 10000 || ids.some((id) => !Number.isInteger(id) || id < 1 || id > 2147483647)) {
      throw new Error("Select between 1 and 10000 valid archive ids.");
    }
    const now = this.now();
    const status: ArchiveDeletionStatus = {
      jobId: randomUUID(),
      running: true,
      startedAt: new Date(now).toISOString(),
      finishedAt: null,
      totalCount: ids.length,
      processedCount: 0,
      deletedCount: 0,
      missingCount: 0,
      failedCount: 0,
      cleanupFailedCount: 0,
      progressPercent: 0,
      elapsedSeconds: 0,
      etaSeconds: null,
      currentFileName: null,
      lastError: null,
    };
    const job: Job = { status, startedAtMs: now, finishedAtMs: null };
    this.job = job;
    // Do not perform even the initial database lookup inside the HTTP request.
    setImmediate(() => { void this.run(job, ids, onFinished); });
    return { started: true, status: this.getStatus() };
  }

  private async run(
    job: Job,
    ids: number[],
    onFinished?: (status: ArchiveDeletionStatus) => Promise<void>,
  ): Promise<void> {
    const state = job.status;
    for (const id of ids) {
      try {
        const result = await this.dependencies.deleteOne(id, (name) => { state.currentFileName = name; });
        if (result === "missing") state.missingCount++;
        else {
          state.deletedCount++;
          if (result === "cleanup-failed") {
            state.cleanupFailedCount++;
            state.lastError = "Some Windows share files could not be removed. See Archive Logs.";
          }
        }
      } catch (error) {
        state.failedCount++;
        state.lastError = "Some archive entries could not be deleted. See Archive Logs.";
        this.reportError(error, id);
      } finally {
        state.processedCount++;
        state.currentFileName = null;
      }
    }
    job.finishedAtMs = this.now();
    state.finishedAt = new Date(job.finishedAtMs).toISOString();
    state.running = false;
    // Logging must not hold the UI at 100% while waiting for another DB write.
    const finished = this.getStatus();
    try { await onFinished?.(finished); }
    catch (error) { this.reportError(error); }
  }

  private reportError(error: unknown, id?: number): void {
    try { this.dependencies.onError(error, id); }
    catch { console.error("Could not log archive deletion error"); }
  }
}
