import assert from "node:assert/strict";
import { after, test } from "node:test";
import type { Request, Response } from "express";
import router from "../routes/archives";
import { archiveDeletion } from "./archive-deletion";
import { pool } from "@workspace/db";

// Stub the start method: these route tests must never delete real data.
after(async () => { await pool.end(); });

test("start route returns 202 immediately, rejects invalid inputs and reports overlapping jobs", async () => {
  const route = router.stack.find((layer) => layer.route?.path === "/archives/delete/start");
  assert.ok(route?.route);
  const handler = route.route.stack[0].handle;
  const original = archiveDeletion.start;
  const status = archiveDeletion.getStatus();
  const received: number[][] = [];
  archiveDeletion.start = (ids) => {
    received.push([...ids]);
    return { started: true, status: { ...status, running: true, jobId: "fake-job", totalCount: ids.length } };
  };
  async function request(body: unknown) {
    let code = 200;
    let result: unknown;
    const res = {
      status(value: number) { code = value; return this; },
      json(value: unknown) { result = value; return this; },
    };
    await handler({ body } as Request, res as unknown as Response, () => {});
    return { code, result };
  }
  try {
    for (const body of [{ ids: [] }, { ids: [0] }, { ids: [1.5] }, { ids: [2147483648] }, { ids: "all" }]) {
      assert.equal((await request(body)).code, 400);
    }
    assert.deepEqual(received, []);
    const started = await request({ ids: [1, 2] });
    assert.equal(started.code, 202);
    assert.deepEqual(received, [[1, 2]]);
    archiveDeletion.start = () => ({ started: false, status: { ...status, running: true } });
    assert.equal((await request({ ids: [3] })).code, 409);
  } finally { archiveDeletion.start = original; }
});
