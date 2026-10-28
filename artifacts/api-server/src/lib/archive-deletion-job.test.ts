import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate as tick } from "node:timers/promises";
import { ArchiveDeletionJob, type ArchiveDeletionStatus } from "./archive-deletion-job";

function gate() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}

async function waitUntil(predicate: () => boolean) {
  for (let i = 0; i < 100; i++) {
    if (predicate()) return;
    await tick();
  }
  assert.fail("Background job did not reach expected state");
}

test("returns immediately, freezes ids, blocks duplicate jobs, and estimates from real progress", async () => {
  let now = 1000;
  const first = gate();
  const second = gate();
  const seen: number[] = [];
  let finished: ArchiveDeletionStatus | undefined;
  const manager = new ArchiveDeletionJob({
    now: () => now,
    onError: () => assert.fail("Unexpected deletion error"),
    async deleteOne(id, setFileName) {
      seen.push(id);
      setFileName(`archive-${id}.gz`);
      await (id === 11 ? first.promise : second.promise);
      return "deleted";
    },
  });
  assert.equal(manager.getStatus().jobId, null);
  const ids = [11, 12, 11];
  const started = manager.start(ids, async (status) => { finished = status; });
  assert.equal(started.started, true);
  assert.equal(started.status.totalCount, 2);
  assert.equal(started.status.etaSeconds, null);
  assert.deepEqual(seen, [], "No deletion before the request can return");
  ids[0] = 999;
  ids.push(1000);
  assert.equal(manager.start([99]).started, false);
  await waitUntil(() => seen.length === 1);
  now = 6000;
  assert.equal(manager.getStatus().etaSeconds, null, "No fabricated ETA before progress");
  assert.equal(manager.getStatus().currentFileName, "archive-11.gz");
  first.resolve();
  await waitUntil(() => seen.length === 2);
  const halfway = manager.getStatus();
  assert.equal(halfway.deletedCount, 1);
  assert.equal(halfway.progressPercent, 50);
  assert.equal(halfway.etaSeconds, 5);
  now = 9000;
  assert.equal(manager.getStatus().etaSeconds, 8, "Estimate adapts to a slow current archive");
  second.resolve();
  await waitUntil(() => !manager.getStatus().running);
  assert.deepEqual(seen, [11, 12], "New ids and caller mutations never expand scope");
  assert.equal(manager.getStatus().progressPercent, 100);
  assert.equal(manager.getStatus().etaSeconds, null);
  assert.equal(finished?.deletedCount, 2);
  assert.equal(manager.getStatus().elapsedSeconds, 8);
  now = 20000;
  assert.equal(manager.getStatus().elapsedSeconds, 8, "Elapsed stops when work ends");
});

test("reports missing rows, DB failures, and share cleanup failures separately and continues", async () => {
  const errors: number[] = [];
  const seen: number[] = [];
  const manager = new ArchiveDeletionJob({
    onError: (_error, id) => { if (id) errors.push(id); },
    async deleteOne(id) {
      seen.push(id);
      if (id === 1) return "missing";
      if (id === 2) throw new Error("Simulated database failure");
      if (id === 3) return "cleanup-failed";
      return "deleted";
    },
  });
  manager.start([1, 2, 3, 4]);
  await waitUntil(() => !manager.getStatus().running);
  const status = manager.getStatus();
  assert.deepEqual(seen, [1, 2, 3, 4]);
  assert.deepEqual(errors, [2]);
  assert.equal(status.processedCount, 4);
  assert.equal(status.deletedCount, 2);
  assert.equal(status.missingCount, 1);
  assert.equal(status.failedCount, 1);
  assert.equal(status.cleanupFailedCount, 1);
  assert.ok(status.lastError);
  const next = manager.start([5]);
  assert.notEqual(next.status.jobId, status.jobId);
  assert.equal(next.status.deletedCount, 0, "A new job does not inherit old counts");
  await waitUntil(() => !manager.getStatus().running);
});

test("invalid selections never start work; completion-log failures do not claim deletion failure", async () => {
  const errors: unknown[] = [];
  const manager = new ArchiveDeletionJob({
    onError: (error) => { errors.push(error); },
    async deleteOne() { return "deleted"; },
  });
  for (const ids of [[], [0], [-1], [1.5], [2147483648], Array.from({ length: 10001 }, (_, i) => i + 1)]) {
    assert.throws(() => manager.start(ids));
  }
  assert.equal(manager.getStatus().jobId, null);
  manager.start([1], async () => { throw new Error("Simulated audit failure"); });
  await waitUntil(() => errors.length === 1);
  assert.equal(manager.getStatus().running, false);
  assert.equal(manager.getStatus().deletedCount, 1);
  assert.equal(manager.getStatus().failedCount, 0);
});
