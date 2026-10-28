import { randomUUID } from "node:crypto";
import {
  createReadStream,
} from "node:fs";
import { readFile, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import path from "node:path";
import { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { and, asc, eq, isNotNull } from "drizzle-orm";
import { db, flowArchivesTable } from "@workspace/db";
import { logger } from "./logger";
import { recordArchiveLog } from "./archive-log";

const LINUX_CIFS_FILESYSTEM_MAGIC = 0xff534d42;
const SHARE_SYNC_BATCH_SIZE = 25;

let shareSyncRunning = false;

function configuredArchiveRoot(): string | null {
  const configured = process.env.ARCHIVE_STORAGE_DIR?.trim();
  if (!configured) return null;
  if (!path.isAbsolute(configured)) {
    throw new Error("ARCHIVE_STORAGE_DIR must be an absolute mounted-share path");
  }
  return path.resolve(configured);
}

export function isArchiveShareConfigured(): boolean {
  return Boolean(process.env.ARCHIVE_STORAGE_DIR?.trim());
}

export function createArchiveStorageKey(fileName: string): string {
  const stem = path
    .basename(fileName)
    .replace(/\.json\.gz$/i, "")
    .replace(/[^A-Za-z0-9._-]+/g, "_");
  return `${stem || "archive"}_${randomUUID()}.json.gz`;
}

async function archiveRoot(): Promise<string> {
  const root = configuredArchiveRoot();
  if (!root) throw new Error("ARCHIVE_STORAGE_DIR is not configured");

  const rootStat = await stat(root);
  if (!rootStat.isDirectory()) {
    throw new Error("ARCHIVE_STORAGE_DIR does not point to a directory");
  }

  // On Linux, refuse to write to an ordinary local directory at the mount path.
  // This prevents an unmounted SMB share from silently filling the server disk.
  if (process.platform === "linux") {
    const filesystem = await statfs(root);
    if ((Number(filesystem.type) >>> 0) !== LINUX_CIFS_FILESYSTEM_MAGIC) {
      throw new Error(
        "ARCHIVE_STORAGE_DIR is not mounted as an SMB/CIFS share",
      );
    }
  } else if (process.platform !== "win32") {
    throw new Error("Archive shares are supported on Linux CIFS or Windows");
  }

  return root;
}

function archivePath(root: string, storageKey: string): string {
  if (
    !storageKey ||
    path.basename(storageKey) !== storageKey ||
    storageKey.includes("/") ||
    storageKey.includes("\\") ||
    !storageKey.endsWith(".json.gz")
  ) {
    throw new Error("Invalid archive storage key");
  }
  return path.join(root, storageKey);
}

export async function readArchiveFromShare(storageKey: string): Promise<Buffer> {
  return readFile(archivePath(await archiveRoot(), storageKey));
}

export async function streamArchiveFromShare(storageKey: string): Promise<Readable> {
  return createReadStream(archivePath(await archiveRoot(), storageKey));
}

export async function deleteArchiveFromShare(storageKey: string): Promise<void> {
  await rm(archivePath(await archiveRoot(), storageKey), { force: true });
}

export async function isArchiveDurable(
  archive: {
    payload: string | null;
    storageKey: string | null;
    compressedBytes: number;
  },
): Promise<boolean> {
  try {
    let source: Readable;
    if (archive.payload !== null) {
      const bytes = Buffer.from(archive.payload, "base64");
      if (
        bytes.length !== archive.compressedBytes ||
        bytes[0] !== 0x1f ||
        bytes[1] !== 0x8b
      ) {
        return false;
      }
      source = Readable.from([bytes]);
    } else {
      if (!archive.storageKey) return false;
      const filePath = archivePath(await archiveRoot(), archive.storageKey);
      const file = await stat(filePath);
      if (!file.isFile() || file.size !== archive.compressedBytes) return false;
      source = createReadStream(filePath);
    }

    // Stream-decompress to a discard sink so gzip CRC/data errors are found
    // without holding the full uncompressed archive in memory.
    await pipeline(
      source,
      createGunzip(),
      new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      }),
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * New archive rows keep their database payload until the share write succeeds.
 * This outbox-style handoff preserves archive/flow transaction safety and lets
 * scheduled retries recover from a share that is temporarily unavailable.
 */
export async function syncPendingArchivesToShare(): Promise<number> {
  if (!isArchiveShareConfigured() || shareSyncRunning) return 0;
  shareSyncRunning = true;

  try {
    const pending = await db
      .select({
        id: flowArchivesTable.id,
        fileName: flowArchivesTable.fileName,
        storageKey: flowArchivesTable.storageKey,
        payload: flowArchivesTable.payload,
      })
      .from(flowArchivesTable)
      .where(
        and(
          isNotNull(flowArchivesTable.storageKey),
          isNotNull(flowArchivesTable.payload),
        ),
      )
      .orderBy(asc(flowArchivesTable.id))
      .limit(SHARE_SYNC_BATCH_SIZE);

    if (pending.length === 0) return 0;

    let root: string;
    try {
      root = await archiveRoot();
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await recordArchiveLog(
        "error",
        "archive.storage.unavailable",
        "Windows archive share is unavailable; new archives remain safely stored in the database",
        detail,
      );
      logger.error({ err: error }, "Archive share unavailable");
      return 0;
    }

    let uploaded = 0;
    for (const archive of pending) {
      if (!archive.storageKey || !archive.payload) continue;
      const destination = archivePath(root, archive.storageKey);
      const temporary = `${destination}.${randomUUID()}.tmp`;
      const bytes = Buffer.from(archive.payload, "base64");

      try {
        await writeFile(temporary, bytes, { flag: "wx" });
        try {
          await rename(temporary, destination);
        } catch (renameError) {
          // Windows may reject rename-over-existing. A matching existing file
          // means a prior attempt completed its write but not the DB update.
          let existing: Buffer | null = null;
          try {
            existing = await readFile(destination);
          } catch {
            // Preserve the original rename error if there is no existing file.
          }

          if (existing?.equals(bytes)) {
            await rm(temporary, { force: true });
          } else if (existing) {
            const backup = `${destination}.${randomUUID()}.previous`;
            await rename(destination, backup);
            await rename(temporary, destination);
          } else {
            throw renameError;
          }
        }

        await db
          .update(flowArchivesTable)
          .set({ payload: null })
          .where(
            and(
              eq(flowArchivesTable.id, archive.id),
              isNotNull(flowArchivesTable.payload),
            ),
          );
        uploaded += 1;
        await recordArchiveLog(
          "info",
          "archive.storage.saved",
          `Saved "${archive.fileName}" to the Windows archive share`,
        );
      } catch (error) {
        await rm(temporary, { force: true }).catch(() => undefined);
        const detail = error instanceof Error ? error.message : String(error);
        logger.warn(
          { err: error, archiveId: archive.id, fileName: archive.fileName },
          "Archive share write failed; database payload retained for retry",
        );
        await recordArchiveLog(
          "warning",
          "archive.storage.write_failed",
          `Could not save "${archive.fileName}" to the Windows share; database copy retained for retry`,
          detail,
        );
      }
    }

    return uploaded;
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    logger.error({ err: error }, "Failed to sync archives to Windows share");
    await recordArchiveLog(
      "error",
      "archive.storage.sync_failed",
      "Could not check pending archive files for the Windows share",
      detail,
    );
    return 0;
  } finally {
    shareSyncRunning = false;
  }
}