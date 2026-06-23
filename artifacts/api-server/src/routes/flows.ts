import { Router, type IRouter } from "express";
import { desc, sql } from "drizzle-orm";
import { db, flowRecordsTable, nasDevicesTable } from "@workspace/db";
import { SearchFlowsBody, ExportFlowsBody } from "@workspace/api-zod";
import { serializeFlow } from "../lib/serializers";
import { buildFlowFilters } from "../lib/flow-filters";
import { buildText, buildExcel, type ExportRow } from "../lib/export";

const router: IRouter = Router();

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
