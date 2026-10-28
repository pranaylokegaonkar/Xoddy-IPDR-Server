import assert from "node:assert/strict";
import { test } from "node:test";
import { Readable } from "node:stream";
import { gzipSync } from "node:zlib";
import { consumeArchive, normalizeArchivedFlow, matchesArchivedFlow } from "./old-search-records";

export const sampleFlow = (id = 1) => ({
  id, nasId: 7, srcIp: "192.0.2.1", dstIp: "198.51.100.1",
  srcNatIp: "203.0.113.1", dstNatIp: null, srcPort: 1000, dstPort: 443,
  protocol: 6, bytes: 1234, packets: 12, flowVersion: "v9",
  startTime: "2026-10-27T18:31:00.000Z", endTime: "2026-10-27T18:32:00.000Z", flowDate: "2026-10-27",
});
test("streaming parser handles compressed chunk boundaries, Unicode and escaped JSON", async () => {
  const input = [{ ...sampleFlow(), extra: 'मराठी "quoted" \\ slash' }, sampleFlow(2)];
  const compressed = gzipSync(JSON.stringify(input));
  const chunks = Array.from({ length: Math.ceil(compressed.length / 3) }, (_, i) => compressed.subarray(i * 3, i * 3 + 3));
  const actual: unknown[] = [];
  await consumeArchive(Readable.from(chunks), 10000, new AbortController().signal, async (r) => { actual.push(r); });
  assert.deepEqual(actual, input);
});
test("malformed, corrupt, oversized, oversized-record and cancelled archives fail closed", async () => {
  const read = (bytes: Buffer, max = 10000, signal = new AbortController().signal) =>
    consumeArchive(Readable.from([bytes]), max, signal, async () => {});
  await assert.rejects(read(gzipSync('[{"id":1}')));
  await assert.rejects(read(Buffer.from("not gzip")));
  const corrupt = gzipSync(JSON.stringify([sampleFlow()])); corrupt[corrupt.length - 8] ^= 1;
  await assert.rejects(read(corrupt));
  await assert.rejects(read(gzipSync(JSON.stringify([sampleFlow()])), 10));
  await assert.rejects(read(gzipSync(JSON.stringify([{ ...sampleFlow(), extra: "x".repeat(100000) }])), 200000), /64 KiB/);
  await assert.rejects(read(gzipSync(JSON.stringify([sampleFlow()])), 10000, AbortSignal.abort()));
});
test("normalization validates records and filters all IP/NAT/NAS/date/time criteria in IST", () => {
  const r = normalizeArchivedFlow(sampleFlow(), "Test NAS");
  assert.equal(r.nasName, "Test NAS");
  assert.equal(r.protocolName, "TCP");
  assert.ok(matchesArchivedFlow(r, {
    srcIp: r.srcIp, dstIp: r.dstIp, srcNatIp: r.srcNatIp!,
    nasId: 7, dateFrom: "2026-10-28", dateTo: "2026-10-28", startTime: "00:01", endTime: "00:02",
  }));
  for (const wrong of [
    { srcIp: "no" }, { dstIp: "no" }, { srcNatIp: "no" }, { dstNatIp: "no" }, { nasId: 8 },
    { dateFrom: "2026-10-29" }, { dateTo: "2026-10-27" }, { startTime: "00:02" }, { endTime: "00:01" },
  ]) assert.equal(matchesArchivedFlow(r, wrong), false);
  assert.throws(() => normalizeArchivedFlow({ ...sampleFlow(), bytes: "123" }, "x"));
  assert.throws(() => normalizeArchivedFlow({ ...sampleFlow(), endTime: "bad" }, "x"));
});
