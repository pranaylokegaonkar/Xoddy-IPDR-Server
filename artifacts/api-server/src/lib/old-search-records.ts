import { Transform, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { setImmediate as yieldToCollector } from "node:timers/promises";
import StreamJson from "stream-json";
import StreamArray from "stream-json/streamers/StreamArray.js";
import type { FlowFilterInput } from "./flow-filters";
import { protocolName } from "./protocols";

export interface ArchivedFlow {
  id: number; nasId: number; nasName: string;
  srcIp: string; dstIp: string; srcNatIp: string | null; dstNatIp: string | null;
  srcPort: number; dstPort: number; protocol: number; protocolName: string;
  bytes: number; packets: number; flowVersion: string;
  startTime: string; endTime: string; flowDate: string;
}

export function normalizeArchivedFlow(value: unknown, nasName: string): ArchivedFlow {
  if (!value || typeof value !== "object") throw new Error("Archive contains an invalid flow record.");
  const r = value as Record<string, unknown>;
  for (const key of ["id", "nasId", "srcPort", "dstPort", "protocol", "bytes", "packets"]) {
    if (typeof r[key] !== "number" || !Number.isSafeInteger(r[key]) || (r[key] as number) < 0)
      throw new Error(`Archive contains an invalid ${key}.`);
  }
  for (const key of ["srcIp", "dstIp", "flowVersion", "flowDate", "startTime", "endTime"]) {
    if (typeof r[key] !== "string") throw new Error(`Archive is missing ${key}.`);
  }
  const start = new Date(r.startTime as string), end = new Date(r.endTime as string);
  if (!Number.isFinite(start.getTime()) || !Number.isFinite(end.getTime()))
    throw new Error("Archive contains an invalid flow timestamp.");
  for (const key of ["srcNatIp", "dstNatIp"]) {
    if (r[key] != null && typeof r[key] !== "string") throw new Error("Invalid NAT address.");
  }
  return {
    id: r.id as number, nasId: r.nasId as number, nasName,
    srcIp: r.srcIp as string, dstIp: r.dstIp as string,
    srcNatIp: r.srcNatIp as string ?? null, dstNatIp: r.dstNatIp as string ?? null,
    srcPort: r.srcPort as number, dstPort: r.dstPort as number,
    protocol: r.protocol as number, protocolName: protocolName(r.protocol as number),
    bytes: r.bytes as number, packets: r.packets as number, flowVersion: r.flowVersion as string,
    startTime: start.toISOString(), endTime: end.toISOString(), flowDate: r.flowDate as string,
  };
}

/** Bounded streaming gunzip + JSON parser; never JSON.parse a complete archive. */
export async function consumeArchive(
  source: Readable,
  maxExpandedBytes: number,
  signal: AbortSignal,
  consume: (value: unknown) => Promise<void>,
): Promise<void> {
  let expanded = 0;
  const limit = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      expanded += chunk.length;
      callback(expanded > maxExpandedBytes ? new Error("Archive exceeds the temporary workspace size limit.") : null, chunk);
    },
  });
  const objects = StreamArray.streamArray();
  let seen = 0;
  // Stream fragments as well as the packed values required by StreamArray.
  // The fragment guard rejects giant records before assembly can grow unbounded.
  const tokens = StreamJson.parser({ streamStrings: true, streamNumbers: true, streamKeys: true });
  let recordCharacters = 0;
  let depth = 0;
  const tokenLimit = new Transform({
    objectMode: true,
    transform(token: { name: string; value?: string }, _encoding, callback) {
      if (token.name === "startObject" || token.name === "startArray") {
        if (depth === 1) recordCharacters = 0;
        ++depth;
      }
      if (depth === 1 && ["startString", "startNumber"].includes(token.name)) recordCharacters = 0;
      if (depth >= 1 && ["stringChunk", "numberChunk"].includes(token.name))
        recordCharacters += token.value?.length ?? 0;
      if (token.name === "endObject" || token.name === "endArray") --depth;
      callback(recordCharacters > 65536 ? new Error("Archive record exceeds the 64 KiB safety limit.") : null, token);
    },
  });
  await pipeline(source, createGunzip(), limit, tokens, tokenLimit, objects, async (records) => {
    for await (const item of records) {
      signal.throwIfAborted();
      await consume((item as { value: unknown }).value);
      if (++seen % 500 === 0) await yieldToCollector();
    }
  }, { signal });
}

const istClock = (timestamp: string) =>
  new Date(new Date(timestamp).getTime() + 330 * 60000).toISOString().slice(11, 16);
export function matchesArchivedFlow(r: ArchivedFlow, f: FlowFilterInput): boolean {
  // Older archives store flowDate in UTC. Calendar filters in Old Search are
  // explicitly IST, so derive the local date without changing the stored field.
  const localDate = f.dateFrom || f.dateTo
    ? new Date(new Date(r.startTime).getTime() + 330 * 60000).toISOString().slice(0, 10) : "";
  return (!f.srcIp || r.srcIp === f.srcIp) &&
    (!f.dstIp || r.dstIp === f.dstIp) &&
    (!f.srcNatIp || r.srcNatIp === f.srcNatIp) &&
    (!f.dstNatIp || r.dstNatIp === f.dstNatIp) &&
    (f.nasId === undefined || r.nasId === f.nasId) &&
    (!f.dateFrom || localDate >= f.dateFrom) &&
    (!f.dateTo || localDate <= f.dateTo) &&
    (!f.startTime || istClock(r.startTime) >= f.startTime) &&
    (!f.endTime || istClock(r.endTime) <= f.endTime);
}
