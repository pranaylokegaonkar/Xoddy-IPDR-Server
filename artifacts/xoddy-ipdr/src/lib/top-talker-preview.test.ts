import assert from "node:assert/strict";
import { test } from "node:test";
import { getTopTalkerDisplay } from "./top-talker-preview";

test("empty Replit development preview shows five clearly distinguishable samples", () => {
  const result = getTopTalkerDisplay([], true, "workspace.sisko.replit.dev");
  assert.equal(result.sample, true);
  assert.equal(result.talkers.length, 5);
  assert.ok(result.talkers.every((r, i, rows) => i === 0 || rows[i - 1].bytes >= r.bytes));
});

test("production, Ubuntu, localhost, API errors and unresolved requests never get sample data", () => {
  for (const [development, hostname] of [
    [false, "workspace.replit.dev"], [false, "203.0.113.25"],
    [true, "203.0.113.25"], [true, "localhost"], [true, "example.replit.dev.other.test"],
  ] as const) {
    assert.deepEqual(getTopTalkerDisplay([], development, hostname), { sample: false, talkers: [] });
  }
  assert.deepEqual(getTopTalkerDisplay([], true, "workspace.replit.dev", true), { sample: false, talkers: [] });
  assert.deepEqual(getTopTalkerDisplay(undefined, true, "workspace.replit.dev"), { sample: false, talkers: [] });
});

test("real records are kept unchanged and never mixed with samples", () => {
  const real = [{ ip: "192.0.2.99", count: 3, bytes: 4500 }];
  const result = getTopTalkerDisplay(real, true, "workspace.replit.dev");
  assert.equal(result.sample, false);
  assert.equal(result.talkers, real);
});
