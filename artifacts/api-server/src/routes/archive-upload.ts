import { raw, Router, type ErrorRequestHandler, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, flowArchivesTable, nasDevicesTable } from "@workspace/db";
import { ArchiveUploadService } from "../lib/archive-upload";
import { MAX_ARCHIVE_UPLOAD_BYTES, validateArchiveFileName } from "../lib/archive-import";
import { createArchiveStorageKey, isArchiveShareConfigured, syncPendingArchivesToShare } from "../lib/archive-storage";
import { recordAudit } from "../lib/audit";
import { logger } from "../lib/logger";

const uploads = new ArchiveUploadService(async (fileName, bytes, metadata) => {
  try {
    const archiveId = await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      await tx.execute(sql`SET LOCAL statement_timeout = '60s'`);
      // Importers cannot race each other into overwriting/repeating a filename.
      await tx.execute(sql`select pg_advisory_xact_lock(1480873043, hashtext(${fileName}))`);
      const [existing] = await tx.select({ id: flowArchivesTable.id }).from(flowArchivesTable)
        .where(eq(flowArchivesTable.fileName, fileName)).limit(1);
      if (existing) throw new Error("An archive with this filename already exists. No file was overwritten.");
      const [nas] = metadata.nasId == null ? [] : await tx.select().from(nasDevicesTable)
        .where(eq(nasDevicesTable.id, metadata.nasId)).limit(1);
      const [archive] = await tx.insert(flowArchivesTable).values({
        ...metadata, fileName, isImported: true,
        nasId: nas?.id ?? null,
        nasName: nas?.name ?? (metadata.nasId == null ? null : `Imported NAS #${metadata.nasId} (not configured)`),
        nasIp: nas?.ipAddress ?? null,
        compressedBytes: bytes.length,
        payload: bytes.toString("base64"),
        storageKey: isArchiveShareConfigured() ? createArchiveStorageKey(fileName) : null,
      }).returning({ id: flowArchivesTable.id });
      return archive!.id;
    });
    // Same durable DB staging and Windows-share delivery as automatic archives.
    if (isArchiveShareConfigured()) void syncPendingArchivesToShare().catch((err) =>
      logger.error({ err }, "Uploaded archive remains safely staged; share delivery failed"));
    return archiveId;
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("An archive with this filename")) throw error;
    logger.error({ err: error }, "Archive upload save failed");
    throw new Error("The archive could not be saved. Check server logs and the archive list before retrying.");
  }
});

export function createArchiveUploadRouter(service = uploads, audit = recordAudit): IRouter {
const router: IRouter = Router();

router.post("/archives/upload", (req, res, next) => {
  let fileName: string;
  try { fileName = validateArchiveFileName(req.query.fileName); }
  catch (error) { res.status(400).json({ error: (error as Error).message }); return; }
  if (!req.is("application/gzip") && !req.is("application/octet-stream")) {
    res.status(415).json({ error: "Upload one .json.gz file using application/gzip." });
    return;
  }
  if (Number(req.headers["content-length"] ?? 0) > MAX_ARCHIVE_UPLOAD_BYTES) {
    res.status(413).json({ error: "Archive files must be 64 MiB or smaller." });
    return;
  }
  try {
    const lease = service.reserve(req.session.user!.id, fileName);
    res.locals.archiveUpload = lease;
    res.once("finish", lease.release);
    res.once("close", lease.release);
    req.once("aborted", lease.release);
    next();
  } catch (error) { res.status(409).json({ error: (error as Error).message }); }
}, raw({ type: () => true, limit: MAX_ARCHIVE_UPLOAD_BYTES, inflate: false }), (req, res) => {
  if (!Buffer.isBuffer(req.body) || !req.body.length) {
    res.status(400).json({ error: "Choose a non-empty .json.gz archive file." });
    return;
  }
  const status = res.locals.archiveUpload.start(req.body);
  res.status(202).json(status);
  void audit(req, "archive.upload.start", `Uploaded "${status.fileName}" for validation`);
});

router.get("/archives/uploads/:id", (req, res) => {
  const status = service.get(String(req.params.id), req.session.user!.id);
  res.setHeader("Cache-Control", "no-store");
  if (!status) {
    res.status(404).json({ error: "Upload status is unavailable. Check the archive list before uploading again." });
    return;
  }
  res.json(status);
});

const uploadError: ErrorRequestHandler = (error, _req, res, next) => {
  if (error.type === "entity.too.large") {
    res.status(413).json({ error: "Archive files must be 64 MiB or smaller." });
  } else if (error.type === "encoding.unsupported") {
    res.status(415).json({ error: "Send the .json.gz file as-is without HTTP Content-Encoding." });
  } else next(error);
};
router.use(uploadError);
return router;
}
export default createArchiveUploadRouter();
