import assert from "node:assert/strict";
import { test } from "node:test";
import { IpNetworkLookup, parseNetworkIps } from "./ip-network";

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));
const response = (asns: unknown[]) => new Response(JSON.stringify({ status: "ok", data: { asns } }));
const google = { asn: 15169, holder: "GOOGLE - Google LLC" };

test("network polling accepts only bounded valid IP lists", () => {
  assert.deepEqual(parseNetworkIps("8.8.8.8, 2001:4860:4860::8888,8.8.8.8"), ["8.8.8.8", "2001:4860:4860::8888"]);
  for (const input of [undefined, {}, [], "", " ", "http://localhost", "8.8.8.8,", "x".repeat(501),
    Array.from({ length: 11 }, (_, n) => `8.8.8.${n + 1}`).join(",")]) {
    assert.equal(parseNetworkIps(input), null);
  }
});

test("private, reserved, documentation and mapped-private IPs never leave the server", () => {
  let calls = 0;
  const lookup = new IpNetworkLookup(async () => { calls++; throw new Error("Must not fetch"); });
  for (const ip of [
    "10.0.0.1", "172.16.0.1", "192.168.1.1", "127.0.0.1", "169.254.1.1", "100.64.0.1",
    "192.0.2.10", "198.51.100.24", "203.0.113.8", "198.18.0.1", "224.0.0.1", "255.255.255.255",
    "::1", "::", "fc00::1", "fe80::1", "ff02::1", "2001:db8::1", "3fff::1", "fe80::1%eth0",
    "::ffff:192.168.1.1", "::ffff:a00:1", "not-an-ip", "http://localhost",
  ]) assert.equal(lookup.get(ip).ispStatus, "not_public", ip);
  assert.equal(lookup.get("192.0.2.10").ispName, "Sample IP — no ISP");
  assert.equal(lookup.get("192.168.1.1").ispName, "Private network");
  assert.equal(calls, 0);
});

test("public lookups are immediate, deduplicated, cached for 24h, and support IPv6", async () => {
  let calls = 0;
  let now = 0;
  const lookup = new IpNetworkLookup(async (url, options) => {
    calls++;
    assert.ok(String(url).startsWith("https://stat.ripe.net/data/prefix-overview/data.json?resource="));
    assert.ok(options?.signal);
    return response([google]);
  }, () => now);
  assert.equal(lookup.get("8.8.8.8").ispStatus, "pending");
  assert.equal(lookup.get("8.8.8.8").ispStatus, "pending");
  assert.equal(calls, 1);
  await settle();
  assert.deepEqual(lookup.get("8.8.8.8"), { ispName: google.holder, asn: 15169, ispStatus: "resolved" });
  now = 23 * 3600000;
  lookup.get("8.8.8.8");
  assert.equal(calls, 1);
  now = 25 * 3600000;
  assert.equal(lookup.get("8.8.8.8").ispStatus, "pending");
  assert.equal(calls, 2);
  await settle();
  assert.equal(lookup.get("2001:4860:4860::8888").ispStatus, "pending");
  await settle();
  assert.equal(lookup.get("2001:4860:4860::8888").asn, 15169);
});

test("provider errors, empty networks, bad responses and timeouts show explicit cached statuses", async () => {
  for (const fetcher of [
    async () => new Response("fail", { status: 503 }),
    async () => new Response("not json"),
    async () => response([{ asn: 15169, holder: "" }]),
    async () => { throw new DOMException("Timed out", "TimeoutError"); },
  ]) {
    let calls = 0;
    let now = 0;
    const lookup = new IpNetworkLookup(async () => { calls++; return fetcher(); }, () => now);
    lookup.get("8.8.8.8");
    await settle();
    assert.equal(lookup.get("8.8.8.8").ispStatus, "unavailable");
    assert.equal(calls, 1);
    now = 5 * 60000 + 1;
    assert.equal(lookup.get("8.8.8.8").ispStatus, "pending");
    await settle();
    assert.equal(calls, 2);
  }
  const empty = new IpNetworkLookup(async () => response([]));
  empty.get("8.8.8.8");
  await settle();
  assert.equal(empty.get("8.8.8.8").ispName, "ISP/network not found");
});

test("limits concurrent requests to two and lets later polls resolve remaining IPs", async () => {
  let calls = 0;
  const finish: Array<(value: Response) => void> = [];
  const lookup = new IpNetworkLookup(async () => {
    calls++;
    return new Promise<Response>((resolve) => finish.push(resolve));
  });
  for (const ip of ["8.8.8.8", "1.1.1.1", "9.9.9.9"]) assert.equal(lookup.get(ip).ispStatus, "pending");
  assert.equal(calls, 2);
  finish.splice(0).forEach((done) => done(response([google])));
  await settle();
  assert.equal(lookup.get("9.9.9.9").ispStatus, "pending");
  assert.equal(calls, 3);
  finish.splice(0).forEach((done) => done(response([google])));
  await settle();
  assert.equal(lookup.get("9.9.9.9").ispStatus, "resolved");
});
