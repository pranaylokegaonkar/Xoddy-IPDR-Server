import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateCpuUsage, CpuUsageSampler, type CpuSnapshot } from "./cpu-usage";

const before: CpuSnapshot = {
  total: 10000, idle: 6000, logicalCpus: 4,
  processMicroseconds: 100000, atNs: 1000000000n,
};
const after: CpuSnapshot = {
  total: 14000, idle: 9000, logicalCpus: 4,
  processMicroseconds: 1100000, atNs: 2000000000n,
};

test("host CPU averages all cores while app CPU uses the one-core scale", () => {
  assert.deepEqual(calculateCpuUsage(before, after), {
    percent: 25, processPercent: 100, logicalCpus: 4,
  });
  assert.equal(calculateCpuUsage(before, { ...after, processMicroseconds: 2100000 })?.processPercent, 200);
  assert.equal(calculateCpuUsage(before, { ...after, idle: 10000 })?.percent, 0);
  assert.equal(calculateCpuUsage(before, { ...after, idle: 6000 })?.percent, 100);
});

test("unsupported, reset or inconsistent counters are unavailable, never a false 0%", () => {
  for (const change of [
    { logicalCpus: 0 }, { logicalCpus: 8 }, { total: 10000 },
    { total: 9000 }, { idle: 5999 }, { idle: 11000 },
    { atNs: before.atNs }, { processMicroseconds: 0 }, { total: NaN },
  ]) assert.equal(calculateCpuUsage(before, { ...after, ...change }), null);
});

test("simultaneous requests share a sample, briefly cache it, and then refresh", async () => {
  let captures = 0;
  let clock = 0;
  let resume!: () => void;
  const wait = new Promise<void>((resolve) => { resume = resolve; });
  const sampler = new CpuUsageSampler(
    () => captures++ % 2 === 0 ? before : after,
    () => wait, () => clock,
  );
  const first = sampler.read();
  const second = sampler.read();
  assert.equal(captures, 1);
  resume();
  const values = await Promise.all([first, second]);
  assert.deepEqual(values[0], values[1]);
  assert.equal(captures, 2);
  await sampler.read();
  assert.equal(captures, 2);
  clock = 1001;
  await sampler.read();
  assert.equal(captures, 4);
});

test("failed probes release the in-flight slot for subsequent requests", async () => {
  let waits = 0;
  let captures = 0;
  const sampler = new CpuUsageSampler(
    () => captures++ === 0 ? before : { ...after },
    async () => { if (waits++ === 0) throw new Error("probe failed"); },
  );
  await assert.rejects(sampler.read(), /probe failed/);
  await sampler.read();
  assert.equal(waits, 2);
});
