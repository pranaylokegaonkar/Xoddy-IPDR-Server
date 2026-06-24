import { Router, type IRouter } from "express";
import { and, eq, sql, inArray } from "drizzle-orm";
import { db, nasDevicesTable, flowRecordsTable } from "@workspace/db";
import {
  CreateNasBody,
  UpdateNasBody,
  SetNasStatusBody,
  GetNasParams,
  UpdateNasParams,
  DeleteNasParams,
  SetNasStatusParams,
  GetNasConfigParams,
} from "@workspace/api-zod";
import { serializeNas } from "../lib/serializers";
import { collectorPort, advertisedHost } from "../lib/collector";
import { recordAudit } from "../lib/audit";

const router: IRouter = Router();

async function flowCountsByNas(
  nasIds: number[],
): Promise<Map<number, number>> {
  const map = new Map<number, number>();
  if (nasIds.length === 0) return map;
  const rows = await db
    .select({
      nasId: flowRecordsTable.nasId,
      count: sql<number>`cast(count(*) as int)`,
    })
    .from(flowRecordsTable)
    .where(inArray(flowRecordsTable.nasId, nasIds))
    .groupBy(flowRecordsTable.nasId);
  for (const r of rows) map.set(r.nasId, r.count);
  return map;
}

function buildConfigCommands(
  ipAddress: string,
  flowVersion: string,
): { commands: string[]; notes: string } {
  const version =
    flowVersion === "ipfix" ? "ipfix" : flowVersion.replace("v", "");
  const commands = [
    "/ip traffic-flow set enabled=yes interfaces=all active-flow-timeout=1m inactive-flow-timeout=15s",
    `/ip traffic-flow target add dst-address=${advertisedHost()} port=${collectorPort()} version=${version} v9-template-refresh=20 v9-template-timeout=30m`,
    "/ip traffic-flow print",
  ];
  const notes =
    "Paste these commands into the MikroTik terminal (or Winbox > New Terminal). " +
    "Ensure the router can reach the collector host over UDP on the listed port. " +
    "Records will appear on the dashboard within a few minutes of the first exported flow.";
  return { commands, notes };
}

router.get("/nas", async (_req, res) => {
  const rows = await db
    .select()
    .from(nasDevicesTable)
    .orderBy(nasDevicesTable.id);
  const counts = await flowCountsByNas(rows.map((r) => r.id));
  res.json(rows.map((r) => serializeNas(r, counts.get(r.id) ?? 0)));
});

router.post("/nas", async (req, res): Promise<void> => {
  const parsed = CreateNasBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const body = parsed.data;
  const [row] = await db
    .insert(nasDevicesTable)
    .values({
      name: body.name,
      ipAddress: body.ipAddress,
      location: body.location ?? null,
      description: body.description ?? null,
      flowVersion: body.flowVersion,
      enabled: body.enabled ?? true,
    })
    .returning();
  await recordAudit(
    req,
    "nas.create",
    `Added NAS "${row!.name}" (${row!.ipAddress})`,
  );
  res.status(201).json(serializeNas(row!, 0));
});

router.get("/nas/:id", async (req, res): Promise<void> => {
  const params = GetNasParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db
    .select()
    .from(nasDevicesTable)
    .where(eq(nasDevicesTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "NAS not found" });
    return;
  }
  const counts = await flowCountsByNas([row.id]);
  res.json(serializeNas(row, counts.get(row.id) ?? 0));
});

router.patch("/nas/:id", async (req, res): Promise<void> => {
  const params = UpdateNasParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = UpdateNasBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const body = parsed.data;
  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = body.name;
  if (body.ipAddress !== undefined) updates.ipAddress = body.ipAddress;
  if (body.location !== undefined) updates.location = body.location;
  if (body.description !== undefined) updates.description = body.description;
  if (body.flowVersion !== undefined) updates.flowVersion = body.flowVersion;
  if (body.enabled !== undefined) updates.enabled = body.enabled;

  let row;
  if (Object.keys(updates).length === 0) {
    [row] = await db
      .select()
      .from(nasDevicesTable)
      .where(eq(nasDevicesTable.id, params.data.id));
  } else {
    [row] = await db
      .update(nasDevicesTable)
      .set(updates)
      .where(eq(nasDevicesTable.id, params.data.id))
      .returning();
  }
  if (!row) {
    res.status(404).json({ error: "NAS not found" });
    return;
  }
  await recordAudit(req, "nas.update", `Updated NAS "${row.name}"`);
  const counts = await flowCountsByNas([row.id]);
  res.json(serializeNas(row, counts.get(row.id) ?? 0));
});

router.delete("/nas/:id", async (req, res): Promise<void> => {
  const params = DeleteNasParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db
    .delete(nasDevicesTable)
    .where(eq(nasDevicesTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "NAS not found" });
    return;
  }
  await recordAudit(req, "nas.delete", `Deleted NAS "${row.name}"`);
  res.status(204).send();
});

router.patch("/nas/:id/status", async (req, res): Promise<void> => {
  const params = SetNasStatusParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const parsed = SetNasStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid input" });
    return;
  }
  const [row] = await db
    .update(nasDevicesTable)
    .set({ enabled: parsed.data.enabled })
    .where(eq(nasDevicesTable.id, params.data.id))
    .returning();
  if (!row) {
    res.status(404).json({ error: "NAS not found" });
    return;
  }
  await recordAudit(
    req,
    "nas.status",
    `${parsed.data.enabled ? "Enabled" : "Disabled"} NAS "${row.name}"`,
  );
  const counts = await flowCountsByNas([row.id]);
  res.json(serializeNas(row, counts.get(row.id) ?? 0));
});

router.get("/nas/:id/config", async (req, res): Promise<void> => {
  const params = GetNasConfigParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [row] = await db
    .select()
    .from(nasDevicesTable)
    .where(eq(nasDevicesTable.id, params.data.id));
  if (!row) {
    res.status(404).json({ error: "NAS not found" });
    return;
  }
  const { commands, notes } = buildConfigCommands(row.ipAddress, row.flowVersion);
  res.json({
    nasId: row.id,
    nasName: row.name,
    flowVersion: row.flowVersion,
    collectorHost: advertisedHost(),
    collectorPort: collectorPort(),
    commands,
    notes,
  });
});

// Delete this NAS's current unarchived (not-yet-compressed) flow records.
// Archived records are kept; only the live, uncompressed buffer is purged.
router.delete("/nas/:id/flows", async (req, res): Promise<void> => {
  const params = GetNasParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const [nas] = await db
    .select()
    .from(nasDevicesTable)
    .where(eq(nasDevicesTable.id, params.data.id));
  if (!nas) {
    res.status(404).json({ error: "NAS not found" });
    return;
  }
  const deleted = await db
    .delete(flowRecordsTable)
    .where(
      and(
        eq(flowRecordsTable.nasId, params.data.id),
        eq(flowRecordsTable.archived, 0),
      ),
    )
    .returning({ id: flowRecordsTable.id });
  await recordAudit(
    req,
    "nas.flows.delete",
    `Deleted ${deleted.length} unarchived flow record(s) for NAS "${nas.name}" (${nas.ipAddress})`,
  );
  res.json({ deleted: deleted.length });
});

export default router;
