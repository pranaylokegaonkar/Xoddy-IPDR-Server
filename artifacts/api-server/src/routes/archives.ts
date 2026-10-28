import { Router, type IRouter } from "express";
import { and, desc, eq, gte, inArray, isNotNull, lt, type SQL } from "drizzle-orm";
import { db, flowArchivesTable, nasDevicesTable } from "@workspace/db";
import { DeleteArchivesBody } from "@workspace/api-zod";
import { serializeArchive } from "../lib/serializers";
import { runCompression, getCompressionStatus } from "../lib/jobs";
import { recordAudit } from "../lib/audit";
import { recordArchiveLog } from "../lib/archive-log";
import { deleteArchiveFromShare, readArchiveFromShare } from "../lib/archive-storage";

const router: IRouter = Router();

const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

function parseNasId(value: unknown): number | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const id = Number(value);
  return Number.isSafeInteger(id) && id <= 2147483647 ? id : null;
}

function parseIstDateBoundary(value: unknown): Date | null | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const utcMidnight = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(utcMidnight.getTime()) ||
    utcMidnight.toISOString().slice(0, 10) !== value
  ) {
    return null;
  }
  return new Date(utcMidnight.getTime() - IST_OFFSET_MS);
}

router.get("/archives", async (req, res): Promise<void> => {
  const nasId = parseNasId(req.query.nasId);
  if (nasId === null) {
    res.status(400).json({ error: "nasId must be a positive integer." });
    return;
  }
  const rawStartDate = req.query.startDate;
  const rawEndDate = req.query.endDate;
  const startBoundary = parseIstDateBoundary(rawStartDate);
  const endDateBoundary = parseIstDateBoundary(rawEndDate);

  if (
    startBoundary === null ||
    endDateBoundary === null ||
    (typeof rawStartDate === "string" &&
      typeof rawEndDate === "string" &&
      rawStartDate > rawEndDate)
  ) {
    res.status(400).json({ error: "Provide valid dates with startDate on or before endDate." });
    return;
  }

  const conditions: SQL[] = [];
  if (nasId !== undefined) {
    conditions.push(eq(flowArchivesTable.nasId, nasId));
  }
  if (startBoundary) {
    conditions.push(gte(flowArchivesTable.periodStart, startBoundary));
  }
  if (endDateBoundary) {
    conditions.push(
      lt(flowArchivesTable.periodStart, new Date(endDateBoundary.getTime() + DAY_MS)),
    );
  }

  const rows = await db
    // Archive payloads can be hundreds of MB each. The list must never read
    // them into API memory; the download route fetches content on demand.
    .select({
      id: flowArchivesTable.id,
      fileName: flowArchivesTable.fileName,
      nasId: flowArchivesTable.nasId,
      nasName: flowArchivesTable.nasName,
      nasIp: flowArchivesTable.nasIp,
      recordCount: flowArchivesTable.recordCount,
      originalBytes: flowArchivesTable.originalBytes,
      compressedBytes: flowArchivesTable.compressedBytes,
      periodStart: flowArchivesTable.periodStart,
      periodEnd: flowArchivesTable.periodEnd,
      createdAt: flowArchivesTable.createdAt,
    })
    .from(flowArchivesTable)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(flowArchivesTable.createdAt));
  res.json(rows.map(serializeArchive));
});

router.get("/archives/nas-options", async (_req, res) => {
  // No joins to flow_records and no archive payload reads for a dropdown.
  const [devices, archivedDevices] = await Promise.all([
    db.select({
      id: nasDevicesTable.id,
      name: nasDevicesTable.name,
      ipAddress: nasDevicesTable.ipAddress,
    }).from(nasDevicesTable),
    db.selectDistinctOn([flowArchivesTable.nasId], {
      id: flowArchivesTable.nasId,
      name: flowArchivesTable.nasName,
      ipAddress: flowArchivesTable.nasIp,
    })
      .from(flowArchivesTable)
      .where(isNotNull(flowArchivesTable.nasId))
      .orderBy(flowArchivesTable.nasId, desc(flowArchivesTable.createdAt)),
  ]);
  const options = new Map<number, { id: number; name: string; ipAddress: string | null }>(
    devices.map((device) => [device.id, device]),
  );
  // Retain filters for archives whose NAS was subsequently removed.
  for (const device of archivedDevices) {
    if (device.id !== null && !options.has(device.id)) {
      options.set(device.id, {
        id: device.id,
        name: device.name ?? `NAS ${device.id}`,
        ipAddress: device.ipAddress,
      });
    }
  }
  res.json([...options.values()].sort((a, b) => a.name.localeCompare(b.name)));
});

router.get("/archives/coverage", async (req, res): Promise<void> => {
  const nasId = parseNasId(req.query.nasId);
  if (nasId === null) {
    res.status(400).json({ error: "nasId must be a positive integer." });
    return;
  }
  // Read one timestamp only, never archive contents or original flow records.
  const [latest] = await db
    .select({ periodEnd: flowArchivesTable.periodEnd })
    .from(flowArchivesTable)
    .where(nasId === undefined ? undefined : eq(flowArchivesTable.nasId, nasId))
    .orderBy(desc(flowArchivesTable.periodEnd))
    .limit(1);
  res.json({ latestPeriodEnd: latest?.periodEnd.toISOString() ?? null });
});

// Bulk delete selected archives. Defined before the `/archives/:id` routes so
// the literal `delete` segment is never parsed as an id.
router.post("/archives/delete", async (req, res): Promise<void> => {
  const parsed = DeleteArchivesBody.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const ids = parsed.data.ids;
  if (ids.length === 0) {
    res.json({ deleted: 0 });
    return;
  }
  const rows = await db
    .select({
      id: flowArchivesTable.id,
      fileName: flowArchivesTable.fileName,
      storageKey: flowArchivesTable.storageKey,
    })
    .from(flowArchivesTable)
    .where(inArray(flowArchivesTable.id, ids));
  const deleted = await db
    .delete(flowArchivesTable)
    .where(inArray(flowArchivesTable.id, ids))
    .returning({ id: flowArchivesTable.id });
  const deletedIds = new Set(deleted.map((row) => row.id));
  for (const row of rows) {
    if (!row.storageKey || !deletedIds.has(row.id)) continue;
    try {
      await deleteArchiveFromShare(row.storageKey);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      req.log.error(
        { err: error, archiveId: row.id },
        "Deleted archive metadata but could not remove its share file",
      );
      await recordArchiveLog(
        "error",
        "archive.storage.delete_failed",
        `Could not remove "${row.fileName}" from the Windows share`,
        detail,
      );
    }
  }
  await recordAudit(req, "archive.delete", `Deleted ${deleted.length} archive(s)`);
  await recordArchiveLog(
    "info",
    "archive.delete",
    `Deleted ${deleted.length} archive file(s)`,
  );
  res.json({ deleted: deleted.length });
});

// Download a single archive as its gzipped .json.gz file.
router.get("/archives/:id/download", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db
    .select()
    .from(flowArchivesTable)
    .where(eq(flowArchivesTable.id, id));
  if (!row || (!row.payload && !row.storageKey)) {
    res.status(404).json({ error: "Archive not found" });
    return;
  }
  let buf: Buffer;
  try {
    buf = row.payload
      ? Buffer.from(row.payload, "base64")
      : await readArchiveFromShare(row.storageKey!);
  } catch (error) {
    req.log.error({ err: error, archiveId: row.id }, "Archive file unavailable");
    res.status(503).json({ error: "Archive storage is unavailable" });
    return;
  }
  res.setHeader("Content-Type", "application/gzip");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="${row.fileName}"`,
  );
  res.setHeader("Content-Length", String(buf.length));
  await recordAudit(req, "archive.download", `Downloaded archive "${row.fileName}"`);
  res.send(buf);
});

router.delete("/archives/:id", async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db
    .delete(flowArchivesTable)
    .where(eq(flowArchivesTable.id, id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "Archive not found" });
    return;
  }
  if (row.storageKey) {
    try {
      await deleteArchiveFromShare(row.storageKey);
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      req.log.error(
        { err: error, archiveId: row.id },
        "Deleted archive metadata but could not remove its share file",
      );
      await recordArchiveLog(
        "error",
        "archive.storage.delete_failed",
        `Could not remove "${row.fileName}" from the Windows share`,
        detail,
      );
    }
  }
  await recordAudit(req, "archive.delete", `Deleted archive "${row.fileName}"`);
  await recordArchiveLog(
    "info",
    "archive.delete",
    `Deleted archive "${row.fileName}"`,
  );
  res.status(204).send();
});

router.post("/archives/compress", (req, res): void => {
  // Respond immediately and do ALL work in the background. The handler must not
  // touch flow_records synchronously: a large backlog (or an unindexed scan)
  // can outlast the reverse-proxy request timeout and surface as a 504. The
  // background job is a safe no-op when no window is ready, and it self-guards
  // against overlapping runs, so firing it unconditionally is fine. New
  // archives show up in the list as each window completes.
  void recordArchiveLog(
    "info",
    "compression.trigger",
    "Manual compression run requested",
  );
  void runCompression()
    .then((results) =>
      req.log.info({ created: results.length }, "Manual compression run finished"),
    )
    .catch((err) => req.log.error({ err }, "Manual compression run failed"));

  res.status(202).json({
    status: "started",
    message: "Compression started. New archives will appear as each window completes.",
  });
});

router.get("/archives/compress/status", (_req, res) => {
  res.json(getCompressionStatus());
});

export default router;
