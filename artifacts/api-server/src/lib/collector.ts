import dgram from "node:dgram";
import { eq } from "drizzle-orm";
import { db, nasDevicesTable, flowRecordsTable } from "@workspace/db";
import { logger } from "./logger";
import type { InsertFlowRecord } from "@workspace/db";

export function collectorPort(): number {
  const raw = process.env.NETFLOW_PORT;
  const n = raw ? Number(raw) : 2055;
  return Number.isFinite(n) && n > 0 ? n : 2055;
}

export function collectorHost(): string {
  return process.env.NETFLOW_HOST ?? "0.0.0.0";
}

// Address the router should target. The collector binds to all interfaces, so
// the bind address (0.0.0.0) is not a usable target — advertise the reachable
// host instead, falling back to a clear placeholder the operator must replace.
export function advertisedHost(): string {
  return (
    process.env.NETFLOW_PUBLIC_HOST ??
    process.env.REPLIT_DEV_DOMAIN ??
    "<collector-ip>"
  );
}

interface ParsedFlow {
  srcIp: string;
  dstIp: string;
  srcNatIp: string | null;
  dstNatIp: string | null;
  srcPort: number;
  dstPort: number;
  protocol: number;
  bytes: number;
  packets: number;
  flowVersion: string;
  startTime: Date;
  endTime: Date;
}

function ipFromBuffer(buf: Buffer, offset: number): string {
  return `${buf[offset]}.${buf[offset + 1]}.${buf[offset + 2]}.${buf[offset + 3]}`;
}

// ---- NetFlow v1 (fixed format) ----
function parseV1(msg: Buffer): ParsedFlow[] {
  const flows: ParsedFlow[] = [];
  if (msg.length < 16) return flows;
  const count = msg.readUInt16BE(2);
  const sysUptime = msg.readUInt32BE(4);
  const unixSecs = msg.readUInt32BE(8);
  const bootTime = unixSecs * 1000 - sysUptime;
  let offset = 16;
  const RECORD_SIZE = 48;
  for (let i = 0; i < count; i++) {
    if (offset + RECORD_SIZE > msg.length) break;
    const first = msg.readUInt32BE(offset + 24);
    const last = msg.readUInt32BE(offset + 28);
    flows.push({
      srcIp: ipFromBuffer(msg, offset),
      dstIp: ipFromBuffer(msg, offset + 4),
      srcNatIp: null,
      dstNatIp: null,
      packets: msg.readUInt32BE(offset + 16),
      bytes: msg.readUInt32BE(offset + 20),
      srcPort: msg.readUInt16BE(offset + 32),
      dstPort: msg.readUInt16BE(offset + 34),
      protocol: msg.readUInt8(offset + 38),
      flowVersion: "v1",
      startTime: new Date(bootTime + first),
      endTime: new Date(bootTime + last),
    });
    offset += RECORD_SIZE;
  }
  return flows;
}

// ---- NetFlow v5 (fixed format) ----
function parseV5(msg: Buffer): ParsedFlow[] {
  const flows: ParsedFlow[] = [];
  if (msg.length < 24) return flows;
  const count = msg.readUInt16BE(2);
  const sysUptime = msg.readUInt32BE(4);
  const unixSecs = msg.readUInt32BE(8);
  const bootTime = unixSecs * 1000 - sysUptime;
  let offset = 24;
  const RECORD_SIZE = 48;
  for (let i = 0; i < count; i++) {
    if (offset + RECORD_SIZE > msg.length) break;
    const first = msg.readUInt32BE(offset + 36);
    const last = msg.readUInt32BE(offset + 40);
    flows.push({
      srcIp: ipFromBuffer(msg, offset),
      dstIp: ipFromBuffer(msg, offset + 4),
      srcNatIp: null,
      dstNatIp: null,
      packets: msg.readUInt32BE(offset + 16),
      bytes: msg.readUInt32BE(offset + 20),
      srcPort: msg.readUInt16BE(offset + 32),
      dstPort: msg.readUInt16BE(offset + 34),
      protocol: msg.readUInt8(offset + 38),
      flowVersion: "v5",
      startTime: new Date(bootTime + first),
      endTime: new Date(bootTime + last),
    });
    offset += RECORD_SIZE;
  }
  return flows;
}

// ---- NetFlow v9 / IPFIX (template based) ----
interface TemplateField {
  type: number;
  length: number;
}
type Template = TemplateField[];

// Templates are cached per exporter + observation domain so data records can be
// decoded on subsequent packets.
const templateCache = new Map<string, Template>();

function templateKey(
  exporter: string,
  domainId: number,
  templateId: number,
): string {
  return `${exporter}:${domainId}:${templateId}`;
}

function readUInt(buf: Buffer, offset: number, length: number): number {
  let value = 0;
  for (let i = 0; i < length; i++) {
    value = value * 256 + buf[offset + i]!;
  }
  return value;
}

// Field type IDs shared by NetFlow v9 and IPFIX.
const F = {
  IN_BYTES: 1,
  IN_PKTS: 2,
  PROTOCOL: 4,
  L4_SRC_PORT: 7,
  IPV4_SRC_ADDR: 8,
  L4_DST_PORT: 11,
  IPV4_DST_ADDR: 12,
  FIRST_SWITCHED: 22,
  LAST_SWITCHED: 21,
  FLOW_START_MS: 152,
  FLOW_END_MS: 153,
  FLOW_START_SECONDS: 150,
  FLOW_END_SECONDS: 151,
  POST_NAT_SRC: 225,
  POST_NAT_DST: 226,
} as const;

function decodeDataRecord(
  buf: Buffer,
  offset: number,
  template: Template,
  version: string,
  bootTime: number,
  exportMs: number,
): ParsedFlow {
  const flow: ParsedFlow = {
    srcIp: "0.0.0.0",
    dstIp: "0.0.0.0",
    srcNatIp: null,
    dstNatIp: null,
    srcPort: 0,
    dstPort: 0,
    protocol: 0,
    bytes: 0,
    packets: 0,
    flowVersion: version,
    startTime: new Date(exportMs),
    endTime: new Date(exportMs),
  };
  let pos = offset;
  let firstSwitched: number | null = null;
  let lastSwitched: number | null = null;
  for (const field of template) {
    const { type, length } = field;
    switch (type) {
      case F.IN_BYTES:
        flow.bytes = readUInt(buf, pos, length);
        break;
      case F.IN_PKTS:
        flow.packets = readUInt(buf, pos, length);
        break;
      case F.PROTOCOL:
        flow.protocol = readUInt(buf, pos, length);
        break;
      case F.L4_SRC_PORT:
        flow.srcPort = readUInt(buf, pos, length);
        break;
      case F.L4_DST_PORT:
        flow.dstPort = readUInt(buf, pos, length);
        break;
      case F.IPV4_SRC_ADDR:
        flow.srcIp = ipFromBuffer(buf, pos);
        break;
      case F.IPV4_DST_ADDR:
        flow.dstIp = ipFromBuffer(buf, pos);
        break;
      case F.POST_NAT_SRC:
        flow.srcNatIp = ipFromBuffer(buf, pos);
        break;
      case F.POST_NAT_DST:
        flow.dstNatIp = ipFromBuffer(buf, pos);
        break;
      case F.FIRST_SWITCHED:
        firstSwitched = readUInt(buf, pos, length);
        break;
      case F.LAST_SWITCHED:
        lastSwitched = readUInt(buf, pos, length);
        break;
      case F.FLOW_START_MS:
        flow.startTime = new Date(readUInt(buf, pos, length));
        break;
      case F.FLOW_END_MS:
        flow.endTime = new Date(readUInt(buf, pos, length));
        break;
      case F.FLOW_START_SECONDS:
        flow.startTime = new Date(readUInt(buf, pos, length) * 1000);
        break;
      case F.FLOW_END_SECONDS:
        flow.endTime = new Date(readUInt(buf, pos, length) * 1000);
        break;
      default:
        break;
    }
    pos += length;
  }
  if (firstSwitched !== null && bootTime > 0) {
    flow.startTime = new Date(bootTime + firstSwitched);
  }
  if (lastSwitched !== null && bootTime > 0) {
    flow.endTime = new Date(bootTime + lastSwitched);
  }
  return flow;
}

function recordLength(template: Template): number {
  return template.reduce((sum, f) => sum + f.length, 0);
}

function parseV9(msg: Buffer, exporter: string): ParsedFlow[] {
  const flows: ParsedFlow[] = [];
  if (msg.length < 20) return flows;
  const sysUptime = msg.readUInt32BE(4);
  const unixSecs = msg.readUInt32BE(8);
  const domainId = msg.readUInt32BE(16);
  const bootTime = unixSecs * 1000 - sysUptime;
  const exportMs = unixSecs * 1000;
  let offset = 20;

  while (offset + 4 <= msg.length) {
    const flowsetId = msg.readUInt16BE(offset);
    const flowsetLength = msg.readUInt16BE(offset + 2);
    if (flowsetLength < 4 || offset + flowsetLength > msg.length) break;
    const setEnd = offset + flowsetLength;
    let pos = offset + 4;

    if (flowsetId === 0) {
      // Template flowset
      while (pos + 4 <= setEnd) {
        const templateId = msg.readUInt16BE(pos);
        const fieldCount = msg.readUInt16BE(pos + 2);
        pos += 4;
        const fields: Template = [];
        for (let i = 0; i < fieldCount && pos + 4 <= setEnd; i++) {
          fields.push({
            type: msg.readUInt16BE(pos),
            length: msg.readUInt16BE(pos + 2),
          });
          pos += 4;
        }
        templateCache.set(templateKey(exporter, domainId, templateId), fields);
      }
    } else if (flowsetId === 1) {
      // Options template — skip body, not needed for flow data.
    } else if (flowsetId >= 256) {
      const template = templateCache.get(
        templateKey(exporter, domainId, flowsetId),
      );
      if (template) {
        const recLen = recordLength(template);
        if (recLen > 0) {
          while (pos + recLen <= setEnd) {
            flows.push(
              decodeDataRecord(msg, pos, template, "v9", bootTime, exportMs),
            );
            pos += recLen;
          }
        }
      }
    }
    offset = setEnd;
  }
  return flows;
}

function parseIpfix(msg: Buffer, exporter: string): ParsedFlow[] {
  const flows: ParsedFlow[] = [];
  if (msg.length < 16) return flows;
  const exportSecs = msg.readUInt32BE(4);
  const domainId = msg.readUInt32BE(12);
  const exportMs = exportSecs * 1000;
  let offset = 16;

  while (offset + 4 <= msg.length) {
    const setId = msg.readUInt16BE(offset);
    const setLength = msg.readUInt16BE(offset + 2);
    if (setLength < 4 || offset + setLength > msg.length) break;
    const setEnd = offset + setLength;
    let pos = offset + 4;

    if (setId === 2) {
      // Template set
      while (pos + 4 <= setEnd) {
        const templateId = msg.readUInt16BE(pos);
        const fieldCount = msg.readUInt16BE(pos + 2);
        pos += 4;
        const fields: Template = [];
        for (let i = 0; i < fieldCount && pos + 4 <= setEnd; i++) {
          const type = msg.readUInt16BE(pos);
          const length = msg.readUInt16BE(pos + 2);
          pos += 4;
          // Enterprise-specific field: skip the 4-byte enterprise number.
          if (type & 0x8000) pos += 4;
          fields.push({ type: type & 0x7fff, length });
        }
        templateCache.set(templateKey(exporter, domainId, templateId), fields);
      }
    } else if (setId === 3) {
      // Options template set — skip.
    } else if (setId >= 256) {
      const template = templateCache.get(
        templateKey(exporter, domainId, setId),
      );
      if (template) {
        const recLen = recordLength(template);
        if (recLen > 0) {
          while (pos + recLen <= setEnd) {
            flows.push(
              decodeDataRecord(msg, pos, template, "ipfix", 0, exportMs),
            );
            pos += recLen;
          }
        }
      }
    }
    offset = setEnd;
  }
  return flows;
}

function parsePacket(msg: Buffer, exporter: string): ParsedFlow[] {
  if (msg.length < 2) return [];
  const version = msg.readUInt16BE(0);
  switch (version) {
    case 1:
      return parseV1(msg);
    case 5:
      return parseV5(msg);
    case 9:
      return parseV9(msg, exporter);
    case 10:
      return parseIpfix(msg, exporter);
    default:
      return [];
  }
}

async function persistFlows(srcAddress: string, flows: ParsedFlow[]) {
  if (flows.length === 0) return;
  const [nas] = await db
    .select()
    .from(nasDevicesTable)
    .where(eq(nasDevicesTable.ipAddress, srcAddress));
  if (!nas || !nas.enabled) return;

  const rows: InsertFlowRecord[] = flows.map((f) => ({
    nasId: nas.id,
    srcIp: f.srcIp,
    dstIp: f.dstIp,
    srcNatIp: f.srcNatIp,
    dstNatIp: f.dstNatIp,
    srcPort: f.srcPort,
    dstPort: f.dstPort,
    protocol: f.protocol,
    bytes: f.bytes,
    packets: f.packets,
    flowVersion: f.flowVersion,
    startTime: f.startTime,
    endTime: f.endTime,
    flowDate: f.startTime.toISOString().slice(0, 10),
  }));

  await db.insert(flowRecordsTable).values(rows);
  await db
    .update(nasDevicesTable)
    .set({ lastSeenAt: new Date() })
    .where(eq(nasDevicesTable.id, nas.id));
}

export function startCollector(): void {
  const socket = dgram.createSocket("udp4");

  socket.on("message", (msg, rinfo) => {
    try {
      const flows = parsePacket(msg, rinfo.address);
      void persistFlows(rinfo.address, flows).catch((err) => {
        logger.error({ err }, "Failed to persist flows");
      });
    } catch (err) {
      logger.error({ err }, "Failed to parse flow packet");
    }
  });

  socket.on("error", (err) => {
    logger.error({ err }, "NetFlow collector socket error");
  });

  socket.bind(collectorPort(), () => {
    logger.info(
      { port: collectorPort() },
      "NetFlow/IPFIX collector listening (UDP)",
    );
  });
}
