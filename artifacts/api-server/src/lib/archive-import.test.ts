import assert from "node:assert/strict";
import { test } from "node:test";
import { gzipSync } from "node:zlib";
import { inspectArchiveUpload, validateArchiveFileName } from "./archive-import";
import { ArchiveUploadService } from "./archive-upload";

const flow = (id = 1) => ({
  id, nasId: 7, srcIp: "192.0.2.1", dstIp: "198.51.100.2", srcNatIp: null, dstNatIp: null,
  srcPort: 12345, dstPort: 443, protocol: 6, bytes: 1000, packets: 10, flowVersion: "v9",
  startTime: "2026-10-28T06:31:00.000Z", endTime: "2026-10-28T06:32:00.000Z", flowDate: "2026-10-28",
});
const encode = (records: unknown) => gzipSync(JSON.stringify(records));
const signal = () => new AbortController().signal;
async function waitFor(service: ArchiveUploadService, id: string, owner = 1) {
  for (let i = 0; i < 200; i++) {
    const status = service.get(id, owner)!;
    if (status.state !== "validating") return status;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Upload did not finish");
}

test("only safe .json.gz filenames are accepted", () => {
  assert.equal(validateArchiveFileName("NAS_2026-10-28_1200IST.json.gz"), "NAS_2026-10-28_1200IST.json.gz");
  assert.equal(validateArchiveFileName("backup.JSON.GZ"), "backup.JSON.GZ");
  for (const name of ["file.json", "file.gz", "file.zip", "../file.json.gz", "dir\\file.json.gz",
    "file.json.gz.exe", " file.json.gz", "file\r\n.json.gz", "", null, ["file.json.gz"], "a".repeat(201) + ".json.gz"]) {
    assert.throws(() => validateArchiveFileName(name));
  }
});

test("inspects real gzip JSON flow arrays and derives sizes, NAS and half-open IST windows", async () => {
  const records = [flow(), flow(2)];
  const metadata = await inspectArchiveUpload(encode(records), signal());
  assert.equal(metadata.recordCount, 2);
  assert.equal(metadata.originalBytes, Buffer.byteLength(JSON.stringify(records)));
  assert.equal(metadata.nasId, 7);
  assert.equal(metadata.periodStart.toISOString(), "2026-10-28T06:30:00.000Z");
  assert.equal(metadata.periodEnd.toISOString(), "2026-10-28T08:30:00.000Z");
  const mixed = await inspectArchiveUpload(encode([flow(), { ...flow(2), nasId: 8, endTime: "2026-10-28T08:30:00Z" }]), signal());
  assert.equal(mixed.nasId, null);
  assert.equal(mixed.periodEnd.toISOString(), "2026-10-28T10:30:00.000Z");
});

test("rejects fake gzip, malformed/corrupt files, invalid records, duplicates, bombs and cancellation", async () => {
  const valid = encode([flow()]);
  const corrupt = Buffer.from(valid); corrupt[corrupt.length - 8] ^= 255;
  for (const bytes of [Buffer.from("not gzip"), gzipSync("bad JSON"), gzipSync("{}"), encode([]),
    encode([{ hello: "world" }]), encode([{ ...flow(), srcIp: "bad IP" }]), encode([{ ...flow(), srcPort: 65536 }]),
    encode([{ ...flow(), startTime: "2026-10-29T06:32:00Z" }]), encode([flow(), flow()]), valid.subarray(0, valid.length - 4), corrupt]) {
    await assert.rejects(inspectArchiveUpload(bytes, signal()));
  }
  await assert.rejects(inspectArchiveUpload(valid, signal(), () => {}, { expandedBytes: 10, records: 100 }));
  await assert.rejects(inspectArchiveUpload(encode([flow(), flow(2)]), signal(), () => {}, { expandedBytes: 10000, records: 1 }));
  const abort = new AbortController(); abort.abort();
  await assert.rejects(inspectArchiveUpload(valid, abort.signal));
});

test("background import is owner-scoped, saves once and prevents concurrent uploads", async () => {
  let saved = 0;
  const service = new ArchiveUploadService(async (name, bytes, metadata) => {
    saved++;
    assert.equal(name, "backup.json.gz"); assert.ok(bytes.length); assert.equal(metadata.recordCount, 1);
    return 123;
  });
  const lease = service.reserve(1, "backup.json.gz");
  assert.throws(() => service.reserve(2, "other.json.gz"), /in progress/);
  const started = lease.start(encode([flow()]));
  lease.release(); // Response finishing must not release a running background job.
  assert.equal(started.state, "validating");
  assert.throws(() => service.reserve(1, "other.json.gz"), /in progress/);
  assert.equal(service.get(started.id, 2), undefined);
  const done = await waitFor(service, started.id);
  assert.equal(done.state, "complete"); assert.equal(done.archiveId, 123); assert.equal(saved, 1);
  service.reserve(1, "other.json.gz").release();
});

test("validation/storage failures do not claim success and release the upload slot", async () => {
  let saved = 0;
  const service = new ArchiveUploadService(async () => { saved++; throw new Error("Save failed"); });
  const bad = service.reserve(1, "bad.json.gz").start(Buffer.from("invalid"));
  assert.equal((await waitFor(service, bad.id)).state, "error");
  assert.equal(saved, 0);
  const valid = service.reserve(1, "valid.json.gz").start(encode([flow()]));
  const failed = await waitFor(service, valid.id);
  assert.equal(failed.state, "error"); assert.equal(failed.archiveId, null); assert.equal(failed.error, "Save failed");
  const aborted = service.reserve(1, "aborted.json.gz"); aborted.release();
  assert.throws(() => aborted.start(encode([flow()])), /no longer active/);
  service.reserve(2, "next.json.gz").release();
});
