import { Router, type IRouter } from "express";
import { desc, sql } from "drizzle-orm";
import { db, flowRecordsTable, nasDevicesTable } from "@workspace/db";
import { SearchFlowsBody, ExportFlowsBody } from "@workspace/api-zod";
import { serializeFlow } from "../lib/serializers";
import { buildFlowFilters } from "../lib/flow-filters";
import { buildText, buildExcel, type ExportRow } from "../lib/export";
import { recordAudit } from "../lib/audit";
import {
  startAllFlowDeletion,
  getAllFlowDeletionStatus,
} from "../lib/all-flow-deletion";

const router: IRouter = Router();

// Start a global background purge of all already-archived flow records (all NAS).
// Frees the hot table without losing IPDR data — every archived row has a durable
// gzip copy in flow_archives. Must NOT run synchronously: millions of rows can
// outlast the reverse-proxy timeout and surface as a 504, so it fires the
// background job and responds 202; the client polls /flows/deletion-status.
router.delete("/flows", async (req, res): Promise<void> => {
  const started = startAllFlowDeletion();
  // Only audit when a run actually began; a duplicate request while one is
  // already in flight is a no-op and must not produce a misleading log entry.
  if (started) {
    await recordAudit(
      req,
      "flow.delete-all",
      "Started global deletion of all archived flow records (hot table purge; archives kept)",
    );
  }
  res.status(202).json({ started });
});

router.get("/flows/deletion-status", (_req, res): void => {
  res.json(getAllFlowDeletionStatus());
});

async function nasNameMap(): Promise<Map<number, string>> {
  const rows = await db
    .select({ id: nasDevicesTable.id, name: nasDevicesTable.name })
    .from(nasDevicesTable);
  return new Map(rows.map((r) => [r.id, r.name]));
}

router.post("/flows/search", async (req, res): Promise<void> => {
  const parsed = SearchFlowsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid search criteria" });
    return;
  }
  const body = parsed.data;
  const page = body.page && body.page > 0 ? body.page : 1;
  const pageSize =
    body.pageSize && body.pageSize > 0 && body.pageSize <= 200
      ? body.pageSize
      : 50;
  const where = buildFlowFilters(body);

  const [{ total }] = await db
    .select({ total: sql<number>`cast(count(*) as int)` })
    .from(flowRecordsTable)
    .where(where);

  const rows = await db
    .select()
    .from(flowRecordsTable)
    .where(where)
    .orderBy(desc(flowRecordsTable.startTime))
    .limit(pageSize)
    .offset((page - 1) * pageSize);

  const names = await nasNameMap();
  res.json({
    records: rows.map((r) => serializeFlow(r, names.get(r.nasId) ?? "Unknown")),
    total: total ?? 0,
    page,
    pageSize,
  });
});

router.post("/flows/export", async (req, res): Promise<void> => {
  const parsed = ExportFlowsBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid export criteria" });
    return;
  }
  const body = parsed.data;
  const where = buildFlowFilters(body);
  const names = await nasNameMap();

  const rows = await db
    .select()
    .from(flowRecordsTable)
    .where(where)
    .orderBy(desc(flowRecordsTable.startTime))
    .limit(50000);

  const exportRows: ExportRow[] = rows.map((r) => ({
    id: r.id,
    nasName: names.get(r.nasId) ?? "Unknown",
    srcIp: r.srcIp,
    dstIp: r.dstIp,
    srcNatIp: r.srcNatIp,
    dstNatIp: r.dstNatIp,
    srcPort: r.srcPort,
    dstPort: r.dstPort,
    protocol: r.protocol,
    bytes: r.bytes,
    packets: r.packets,
    flowVersion: r.flowVersion,
    startTime: r.startTime,
    endTime: r.endTime,
    flowDate: r.flowDate,
  }));

  await recordAudit(
    req,
    "flow.export",
    `Exported ${exportRows.length} flow record(s) as ${body.format}`,
  );

  if (body.format === "excel") {
    const buf = await buildExcel(exportRows);
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="ipdr-export.xlsx"',
    );
    res.send(buf);
    return;
  }

  const text = buildText(exportRows);
  res.setHeader("Content-Type", "text/plain; charset=utf-8");
  res.setHeader(
    "Content-Disposition",
    'attachment; filename="ipdr-export.txt"',
  );
  res.send(text);
});

export default router;
