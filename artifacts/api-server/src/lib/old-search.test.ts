import assert from "node:assert/strict";
import { after, test, type TestContext } from "node:test";
import { EventEmitter } from "node:events";
import { gzipSync } from "node:zlib";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import type { Request, Response } from "express";
import { db, pool } from "@workspace/db";
import {
  prepareOldSession, oldSessionStatus, releaseOldSession, useOldWorkspace, scanOldWorkspace,
  listOldSessions, validateArchiveRange, validateOldFilters, WORKSPACE_BYTES,
} from "./old-search";
import { ARCHIVE_LOCK_NAMESPACE, withArchiveDeletionLocks, ArchiveLockedError } from "./archive-locks";
import { normalizeArchivedFlow } from "./old-search-records";
import router from "../routes/old-search";

const row = (id: number, endTime = "2026-10-28T01:00:00Z") => ({
  id, nasId: 7, srcIp: "192.0.2.1", dstIp: "198.51.100.1", srcNatIp: null, dstNatIp: null,
  srcPort: 123, dstPort: 443, protocol: 6, bytes: 456, packets: 1, flowVersion: "v9",
  startTime: "2026-10-28T00:59:00Z", endTime, flowDate: "2026-10-28",
});
const range = { startAt: new Date("2026-10-28T00:00:00Z"), endAt: new Date("2026-10-28T02:00:00Z") };
function fixtures(t: TestContext, groups: ReturnType<typeof row>[][], expandedBytes?: number) {
  const clients: (EventEmitter & { released: boolean; query: () => Promise<unknown>; release: () => void })[] = [];
  t.mock.method(pool, "connect", (async () => {
    const c = Object.assign(new EventEmitter(), {
      released: false, query: async () => ({ rows: groups.map(() => ({ locked: true })) }),
      release() { c.released = true; },
    });
    clients.push(c); return c;
  }) as unknown as typeof pool.connect);
  let payloadIndex = 0;
  t.mock.method(db, "select", ((fields: Record<string, unknown>) => {
    const selected = "payload" in fields
      ? [{ payload: gzipSync(JSON.stringify(groups[payloadIndex++])).toString("base64"), storageKey: null }]
      : groups.map((flows, index) => ({
        id: index + 1, fileName: `fixture-${index}.json.gz`, nasId: 7, nasName: "Fixture NAS", nasIp: "192.0.2.2",
        recordCount: flows.length, originalBytes: expandedBytes ?? Buffer.byteLength(JSON.stringify(flows)),
        compressedBytes: 100, periodStart: range.startAt, periodEnd: range.endAt, createdAt: new Date(),
      }));
    const query = Object.assign(Promise.resolve(selected), {
      from: () => query, where: () => query, orderBy: () => query, limit: () => query,
    });
    return query;
  }) as unknown as typeof db.select);
  return clients;
}
async function ready(owner: number, id: string) {
  for (let i = 0; i < 200; ++i) {
    const status = await oldSessionStatus(owner, id);
    if (status.state !== "preparing") { assert.equal(status.state, "ready", status.error ?? ""); return status; }
    await new Promise((r) => setTimeout(r, 5));
  }
  assert.fail("Preparation did not finish");
}
after(async () => { await pool.end(); });

test("temporary preparation filters exact range/NAS, deduplicates, paginates, isolates owners and releases only copies", async (t) => {
  const clients = fixtures(t, [
    [row(1), row(2), row(3, "2026-10-28T03:00:00Z"), { ...row(4), nasId: 8 }],
    [row(2), row(5)],
  ]);
  const input = { ...range, nasId: 7, archiveIds: [1, 2] };
  const initial = await prepareOldSession(101, input);
  try {
    assert.equal(initial.state, "preparing");
    await assert.rejects(oldSessionStatus(102, initial.id), /not found/);
    assert.deepEqual(listOldSessions(102), []);
    await assert.rejects(prepareOldSession(101, input), /existing/);
    const status = await ready(101, initial.id);
    assert.equal(status.scannedRecords, 6);
    assert.equal(status.recordCount, 3);
    assert.equal(status.progressPercent, 100);
    assert.equal(clients[0].released, false);
    const expires = status.expiresAt.getTime();
    assert.equal((await oldSessionStatus(101, initial.id)).expiresAt.getTime(), expires, "status polling must not extend TTL");
    const result = await useOldWorkspace(101, initial.id, (s) => scanOldWorkspace(s, { page: 2, pageSize: 2 }));
    assert.equal(result.total, 3);
    assert.deepEqual(result.records.map((r) => r.id), [5]);
    const none = await useOldWorkspace(101, initial.id, (s) => scanOldWorkspace(s, { dstIp: "nonexistent" }));
    assert.equal(none.total, 0);
    await useOldWorkspace(101, initial.id, async () => {
      await assert.rejects(releaseOldSession(101, initial.id), /running/);
    });
    const exported = await useOldWorkspace(101, initial.id, (s) => scanOldWorkspace(s, {}, true));
    assert.equal(exported.records.length, 3);
  } finally { await releaseOldSession(101, initial.id); }
  assert.equal(clients[0].released, true);
  assert.equal((await oldSessionStatus(101, initial.id)).state, "released");
  assert.deepEqual(await releaseOldSession(101, initial.id), { released: true });
  await assert.rejects(useOldWorkspace(101, initial.id, async () => {}), /not ready/);
});
test("preparation can be cancelled, oversized selection is rejected and protection loss removes workspace", async (t) => {
  const clients = fixtures(t, [[row(11)]]);
  const s = await prepareOldSession(103, { ...range, archiveIds: [1] });
  await releaseOldSession(103, s.id);
  assert.equal((await oldSessionStatus(103, s.id)).state, "released");
  assert.equal(clients[0].released, true);
  const next = await prepareOldSession(103, { ...range, archiveIds: [1] });
  await ready(103, next.id);
  clients[1].emit("error", new Error("simulated connection loss"));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal((await oldSessionStatus(103, next.id)).state, "error");
  assert.equal(clients[1].released, true);
});
test("oversized metadata fails before decompression; range and filter validation reject invalid inputs", async (t) => {
  const clients = fixtures(t, [[row(12)]], WORKSPACE_BYTES + 1);
  await assert.rejects(prepareOldSession(104, { ...range, archiveIds: [1] }), /512 MiB/);
  assert.equal(clients[0].released, true);
  assert.throws(() => validateArchiveRange({ startAt: range.endAt, endAt: range.startAt }), /start/);
  for (const f of [{ page: -1 }, { pageSize: 201 }, { nasId: 1.5 }, { startTime: "25:00" }, { dateFrom: "2026-02-30" }])
    assert.throws(() => validateOldFilters(f));
});
test("expiry removes temporary data without status polling extending the deadline", async (t) => {
  const clients = fixtures(t, [[row(14)]]);
  const s = await prepareOldSession(105, { ...range, archiveIds: [1] });
  const status = await ready(105, s.id);
  t.mock.method(Date, "now", () => status.expiresAt.getTime() + 1);
  assert.equal((await oldSessionStatus(105, s.id)).state, "expired");
  assert.equal(clients[0].released, true);
  await assert.rejects(useOldWorkspace(105, s.id, async () => {}), /not ready/);
});
test("text and Excel exports use filters and optional release happens after transfer", async (t) => {
  fixtures(t, [[row(15), { ...row(16), srcIp: "192.0.2.99" }]]);
  // Audit is stubbed too: this test never writes to the application database.
  t.mock.method(db, "insert", (() => ({ values: async () => [] })) as unknown as typeof db.insert);
  const s = await prepareOldSession(106, { ...range, archiveIds: [1] });
  await ready(106, s.id);
  const route = router.stack.find((layer) => layer.route?.path === "/old-search/sessions/:id/export");
  assert.ok(route?.route);
  const handler = route.route.stack[0].handle;
  async function request(body: unknown) {
    const emitter = new EventEmitter();
    const res = Object.assign(emitter, {
      code: 200, headersSent: false, body: undefined as unknown,
      headers: {} as Record<string, string>,
      status(code: number) { this.code = code; return this; },
      setHeader(key: string, value: string) { this.headers[key] = value; return this; },
      json(value: unknown) { this.body = value; return this; },
      send(value: unknown) { this.body = value; this.headersSent = true; queueMicrotask(() => emitter.emit("finish")); return this; },
      destroy() {},
    });
    await handler({ body, params: { id: s.id }, session: { user: { id: 106 } }, log: { error() {} } } as unknown as Request,
      res as unknown as Response, () => {});
    return res;
  }
  try {
    const text = await request({ format: "text", srcIp: "192.0.2.99" });
    assert.equal(text.code, 200);
    assert.equal(typeof text.body, "string");
    assert.ok((text.body as string).includes("192.0.2.99"));
    assert.equal((text.body as string).split("\n").length, 2);
    assert.equal((await oldSessionStatus(106, s.id)).state, "ready", "manual release is the default");
    const excel = await request({ format: "excel", releaseAfterExport: true });
    assert.equal(excel.code, 200);
    assert.ok(Buffer.isBuffer(excel.body));
    assert.equal((excel.body as Buffer).subarray(0, 2).toString(), "PK");
    assert.equal((await oldSessionStatus(106, s.id)).state, "released");
  } finally { await releaseOldSession(106, s.id); }
});
test("exports over 50000 matches are rejected instead of silently truncated", async (t) => {
  fixtures(t, [[row(17)]]);
  const s = await prepareOldSession(107, { ...range, archiveIds: [1] });
  await ready(107, s.id);
  try {
    await useOldWorkspace(107, s.id, async (workspace) => {
      const line = JSON.stringify(normalizeArchivedFlow(row(17), "Fixture")) + "\n";
      await writeFile(path.join(workspace.directory, "records.ndjson"), line.repeat(50001));
      await assert.rejects(scanOldWorkspace(workspace, {}, true), /50,000/);
    });
  } finally { await releaseOldSession(107, s.id); }
});
test("PostgreSQL advisory locks reject deletion while a shared workspace lock is held", async () => {
  // Negative fixture IDs cannot identify real serial archive rows. No rows are read or changed.
  const id = -102030;
  const reader = await pool.connect();
  try {
    await reader.query("SELECT pg_advisory_lock_shared($1::int, $2::int)", [ARCHIVE_LOCK_NAMESPACE, id]);
    let ran = false;
    await assert.rejects(withArchiveDeletionLocks([id], async () => { ran = true; }), ArchiveLockedError);
    assert.equal(ran, false);
    await reader.query("SELECT pg_advisory_unlock_shared($1::int, $2::int)", [ARCHIVE_LOCK_NAMESPACE, id]);
    await withArchiveDeletionLocks([id], async () => { ran = true; });
    assert.equal(ran, true);
  } finally { reader.release(true); }
});
