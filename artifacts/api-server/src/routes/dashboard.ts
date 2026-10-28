import { Router, type IRouter } from "express";
import os from "node:os";
import { statfs, readFile } from "node:fs/promises";
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
import { CpuUsageSampler } from "../lib/cpu-usage";

const router: IRouter = Router();
const cpuSampler = new CpuUsageSampler();

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

// Read accurate memory figures from /proc/meminfo when available (Linux):
// MemAvailable reflects memory actually reclaimable for new work, so it matches
// what `free -h` reports far better than os.freemem() (which excludes cache and
// makes "used" look alarmingly high). Falls back to os.* on non-Linux hosts.
async function readMemory(): Promise<{
  total: number;
  used: number;
  free: number;
}> {
  try {
    const text = await readFile("/proc/meminfo", "utf8");
    const kb = (key: string) => {
      const m = text.match(new RegExp(`^${key}:\\s+(\\d+)\\s+kB`, "m"));
      return m ? Number(m[1]) * 1024 : null;
    };
    const total = kb("MemTotal");
    const available = kb("MemAvailable");
    if (total != null && available != null) {
      const free = Math.min(available, total);
      return { total, used: total - free, free };
    }
  } catch {
    // fall through to os.* below
  }
  const total = os.totalmem();
  const free = os.freemem();
  return { total, used: total - free, free };
}

router.get("/dashboard/system-resources", async (_req, res) => {
  // Disk usage of the filesystem hosting the running app (its data dir). statfs
  // is available in Node 18.15+/19.6+ (Node 24 here). "free" uses bavail (space
  // available to unprivileged processes, matching `df`'s Avail column).
  const [disk, memory, cpu] = await Promise.all([
    (async () => {
      try {
        const s = await statfs(process.cwd());
        const total = s.blocks * s.bsize;
        const free = s.bavail * s.bsize;
        const used = total - s.bfree * s.bsize;
        return { total, used, free };
      } catch {
        return { total: 0, used: 0, free: 0 };
      }
    })(),
    readMemory(),
    cpuSampler.read().catch((err) => {
      _req.log.warn({ err }, "CPU utilization sample failed");
      return null;
    }),
  ]);

  // Percent over used+free (not total) so it matches `df`'s Use% column: on a
  // filesystem with root-reserved blocks, total > used+free, and `df` reports
  // used/(used+avail). For memory used+free === total, so this is equivalent.
  const withPercent = (r: { total: number; used: number; free: number }) => {
    const denom = r.used + r.free;
    return { ...r, percent: denom > 0 ? (r.used / denom) * 100 : 0 };
  };

  res.setHeader("Cache-Control", "no-store");
  res.json({ disk: withPercent(disk), memory: withPercent(memory), cpu });
});

export default router;
