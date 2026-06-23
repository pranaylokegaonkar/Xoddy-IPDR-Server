import { Router, type IRouter } from "express";
import { sql, eq, desc } from "drizzle-orm";
import {
  db,
  flowRecordsTable,
  nasDevicesTable,
  notificationsTable,
  flowArchivesTable,
} from "@workspace/db";
import { nasStatus } from "../lib/serializers";
import { collectorPort } from "../lib/collector";

const router: IRouter = Router();

router.get("/dashboard/summary", async (_req, res) => {
  const today = new Date().toISOString().slice(0, 10);

  const [[flowAgg], nasRows, [unread], [archives], [lastFlow]] =
    await Promise.all([
      db
        .select({
          total: sql<number>`cast(count(*) as int)`,
          totalBytes: sql<number>`coalesce(sum(${flowRecordsTable.bytes}), 0)`,
          flowsToday: sql<number>`cast(count(*) filter (where ${flowRecordsTable.flowDate} = ${today}) as int)`,
        })
        .from(flowRecordsTable),
      db.select().from(nasDevicesTable),
      db
        .select({ c: sql<number>`cast(count(*) as int)` })
        .from(notificationsTable)
        .where(eq(notificationsTable.read, false)),
      db
        .select({ c: sql<number>`cast(count(*) as int)` })
        .from(flowArchivesTable),
      db
        .select({ t: flowRecordsTable.endTime })
        .from(flowRecordsTable)
        .orderBy(desc(flowRecordsTable.endTime))
        .limit(1),
    ]);

  let activeNas = 0;
  let inactiveNas = 0;
  for (const n of nasRows) {
    if (nasStatus(n) === "active") activeNas += 1;
    else inactiveNas += 1;
  }

  res.json({
    totalFlows: flowAgg?.total ?? 0,
    flowsToday: flowAgg?.flowsToday ?? 0,
    totalNas: nasRows.length,
    activeNas,
    inactiveNas,
    totalBytes: Number(flowAgg?.totalBytes ?? 0),
    unreadNotifications: unread?.c ?? 0,
    archivedBatches: archives?.c ?? 0,
    collectorPort: collectorPort(),
    lastFlowAt: lastFlow?.t ? lastFlow.t.toISOString() : null,
  });
});

router.get("/dashboard/flow-trend", async (_req, res) => {
  const rows = await db
    .select({
      hour: sql<string>`to_char(date_trunc('hour', ${flowRecordsTable.startTime}), 'YYYY-MM-DD"T"HH24:00')`,
      count: sql<number>`cast(count(*) as int)`,
      bytes: sql<number>`coalesce(sum(${flowRecordsTable.bytes}), 0)`,
    })
    .from(flowRecordsTable)
    .where(sql`${flowRecordsTable.startTime} >= now() - interval '24 hours'`)
    .groupBy(sql`date_trunc('hour', ${flowRecordsTable.startTime})`)
    .orderBy(sql`date_trunc('hour', ${flowRecordsTable.startTime})`);

  res.json(
    rows.map((r) => ({
      time: r.hour,
      count: r.count,
      bytes: Number(r.bytes),
    })),
  );
});

router.get("/dashboard/top-nas", async (_req, res) => {
  const rows = await db
    .select({
      nasId: flowRecordsTable.nasId,
      nasName: nasDevicesTable.name,
      count: sql<number>`cast(count(*) as int)`,
      bytes: sql<number>`coalesce(sum(${flowRecordsTable.bytes}), 0)`,
    })
    .from(flowRecordsTable)
    .innerJoin(nasDevicesTable, eq(flowRecordsTable.nasId, nasDevicesTable.id))
    .groupBy(flowRecordsTable.nasId, nasDevicesTable.name)
    .orderBy(desc(sql`sum(${flowRecordsTable.bytes})`))
    .limit(10);

  res.json(
    rows.map((r) => ({
      nasId: r.nasId,
      nasName: r.nasName,
      count: r.count,
      bytes: Number(r.bytes),
    })),
  );
});

router.get("/dashboard/top-talkers", async (_req, res) => {
  const rows = await db
    .select({
      ip: flowRecordsTable.srcIp,
      count: sql<number>`cast(count(*) as int)`,
      bytes: sql<number>`coalesce(sum(${flowRecordsTable.bytes}), 0)`,
    })
    .from(flowRecordsTable)
    .groupBy(flowRecordsTable.srcIp)
    .orderBy(desc(sql`sum(${flowRecordsTable.bytes})`))
    .limit(10);

  res.json(
    rows.map((r) => ({
      ip: r.ip,
      count: r.count,
      bytes: Number(r.bytes),
    })),
  );
});

export default router;
