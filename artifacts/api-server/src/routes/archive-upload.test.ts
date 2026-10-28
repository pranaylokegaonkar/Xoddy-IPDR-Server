import assert from "node:assert/strict";
import { test } from "node:test";
import express from "express";
import { gzipSync } from "node:zlib";
import { createArchiveUploadRouter } from "./archive-upload";
import { ArchiveUploadService } from "../lib/archive-upload";

test("raw File upload, result polling and rejection work through the actual HTTP router", async (t) => {
  const bytes = gzipSync(JSON.stringify([{
    id: 1, nasId: 1, srcIp: "192.0.2.1", dstIp: "198.51.100.2",
    srcNatIp: null, dstNatIp: null, srcPort: 1000, dstPort: 443,
    protocol: 6, bytes: 1234, packets: 12, flowVersion: "v9",
    startTime: "2026-10-28T06:31:00Z", endTime: "2026-10-28T06:32:00Z", flowDate: "2026-10-28",
  }]));
  let saves = 0;
  const service = new ArchiveUploadService(async (name, received, metadata) => {
    assert.equal(name, "backup.json.gz"); assert.deepEqual(received, bytes);
    assert.equal(metadata.recordCount, 1); saves++;
    return 99; // Synthetic store only: no real database writes.
  });
  const app = express();
  app.use((req, _res, next) => {
    req.session = { user: { id: Number(req.headers["x-test-owner"] ?? 1) } } as typeof req.session;
    next();
  });
  app.use(createArchiveUploadRouter(service, async () => {}));
  const server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server.once("listening", resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const post = (name: string, file: Blob = new File([bytes], name), type = "application/gzip") =>
    fetch(`${base}/archives/upload?fileName=${encodeURIComponent(name)}`, {
      method: "POST", body: file, headers: { "Content-Type": type },
    });
  assert.equal((await post("backup.zip")).status, 400);
  assert.equal((await post("backup.json.gz", undefined, "text/plain")).status, 415);
  const accepted = await post("backup.json.gz");
  assert.equal(accepted.status, 202);
  const started = await accepted.json() as { id: string };
  assert.equal((await fetch(`${base}/archives/uploads/${started.id}`, { headers: { "x-test-owner": "2" } })).status, 404);
  let state = "validating";
  for (let n = 0; n < 200 && state === "validating"; n++) {
    const status = await (await fetch(`${base}/archives/uploads/${started.id}`)).json() as { state: string; archiveId: number };
    state = status.state;
    if (state === "complete") assert.equal(status.archiveId, 99);
    if (state === "validating") await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(state, "complete"); assert.equal(saves, 1);
  const bad = await post("bad.json.gz", new Blob(["renamed, not gzip"]));
  assert.equal(bad.status, 202);
  const badJob = await bad.json() as { id: string };
  for (let n = 0; n < 200; n++) {
    const status = await (await fetch(`${base}/archives/uploads/${badJob.id}`)).json() as { state: string };
    if (status.state === "error") break;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.equal(service.get(badJob.id, 1)?.state, "error");
  assert.equal(saves, 1);
});
