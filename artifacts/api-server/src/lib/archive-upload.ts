import { randomUUID } from "node:crypto";
import { inspectArchiveUpload, type ArchiveImportMetadata } from "./archive-import";

export interface ArchiveUploadStatus {
  id: string;
  fileName: string;
  state: "validating" | "complete" | "error";
  recordCount: number;
  archiveId: number | null;
  error: string | null;
  periodStart: string | null;
  periodEnd: string | null;
}

type SaveArchive = (fileName: string, bytes: Buffer, metadata: ArchiveImportMetadata) => Promise<number>;

export class ArchiveUploadService {
  private active: symbol | null = null;
  private jobs = new Map<string, { owner: number; updated: number; status: ArchiveUploadStatus }>();
  constructor(private save: SaveArchive) {}

  get(id: string, owner: number): ArchiveUploadStatus | undefined {
    const job = this.jobs.get(id);
    return job?.owner === owner ? { ...job.status } : undefined;
  }

  reserve(owner: number, fileName: string) {
    if (this.active) throw new Error("Another archive upload is in progress. Please wait for it to finish.");
    for (const [id, job] of this.jobs) {
      if (job.status.state !== "validating" && Date.now() - job.updated > 3600000) this.jobs.delete(id);
    }
    if (this.jobs.size >= 100) {
      const oldest = [...this.jobs].find(([, job]) => job.status.state !== "validating");
      if (oldest) this.jobs.delete(oldest[0]);
    }
    const token = Symbol();
    this.active = token;
    let started = false, released = false;
    const finish = () => {
      released = true;
      if (this.active === token) this.active = null;
    };
    return {
      release: () => { if (!started) finish(); },
      start: (bytes: Buffer) => {
        if (started || released || this.active !== token) throw new Error("This upload is no longer active.");
        started = true;
        const status: ArchiveUploadStatus = {
          id: randomUUID(), fileName, state: "validating", recordCount: 0,
          archiveId: null, error: null, periodStart: null, periodEnd: null,
        };
        this.jobs.set(status.id, { owner, updated: Date.now(), status });
        setImmediate(() => {
          void (async () => {
            try {
              const metadata = await inspectArchiveUpload(
                bytes, AbortSignal.timeout(15 * 60000), (count) => { status.recordCount = count; },
              );
              status.archiveId = await this.save(fileName, bytes, metadata);
              status.periodStart = metadata.periodStart.toISOString();
              status.periodEnd = metadata.periodEnd.toISOString();
              status.state = "complete";
            } catch (error) {
              status.state = "error";
              status.error = error instanceof Error ? error.message : "The archive could not be uploaded.";
            } finally {
              const job = this.jobs.get(status.id);
              if (job) job.updated = Date.now();
              finish();
            }
          })();
        });
        return { ...status };
      },
    };
  }
}
