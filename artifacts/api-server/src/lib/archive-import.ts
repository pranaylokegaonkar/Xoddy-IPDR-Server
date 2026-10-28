import { isIP } from "node:net";
import { Readable } from "node:stream";
import { consumeArchive, normalizeArchivedFlow } from "./old-search-records";

export const MAX_ARCHIVE_UPLOAD_BYTES = 64 * 1024 * 1024;
const DEFAULT_LIMITS = { expandedBytes: 512 * 1024 * 1024, records: 1000000 };
const WINDOW_MS = 2 * 60 * 60 * 1000;
const IST_MS = 330 * 60000;

export interface ArchiveImportMetadata {
  recordCount: number;
  originalBytes: number;
  nasId: number | null;
  periodStart: Date;
  periodEnd: Date;
}

export function validateArchiveFileName(value: unknown): string {
  if (typeof value !== "string" || value.length > 200 ||
      !/^[^/\\\x00-\x1f\x7f]+\.json\.gz$/i.test(value) || value.trim() !== value) {
    throw new Error("Only .json.gz archive files are accepted. Use a filename without folders.");
  }
  return value;
}

export async function inspectArchiveUpload(
  bytes: Buffer,
  signal: AbortSignal,
  onRecords: (count: number) => void = () => {},
  limits = DEFAULT_LIMITS,
): Promise<ArchiveImportMetadata> {
  if (bytes.length > MAX_ARCHIVE_UPLOAD_BYTES) throw new Error("Archive files must be 64 MiB or smaller.");
  if (bytes.length < 3 || bytes[0] !== 0x1f || bytes[1] !== 0x8b || bytes[2] !== 8) {
    throw new Error("The file is not a valid gzip archive.");
  }
  let recordCount = 0, minTime = Infinity, maxTime = -Infinity;
  let nasId: number | null = null;
  const ids = new Set<number>();
  const originalBytes = await consumeArchive(Readable.from([bytes]), limits.expandedBytes, signal, async (value) => {
    const row = normalizeArchivedFlow(value, "");
    const day = Date.parse(`${row.flowDate}T00:00:00Z`);
    if (++recordCount > limits.records) throw new Error(`Archive exceeds the ${limits.records.toLocaleString("en-US")}-record limit.`);
    if (row.id < 1 || row.nasId < 1 || row.nasId > 2147483647 ||
        row.srcPort > 65535 || row.dstPort > 65535 || row.protocol > 255 ||
        !isIP(row.srcIp) || !isIP(row.dstIp) ||
        (row.srcNatIp && !isIP(row.srcNatIp)) || (row.dstNatIp && !isIP(row.dstNatIp)) ||
        !/^\d{4}-\d{2}-\d{2}$/.test(row.flowDate) ||
        !Number.isFinite(day) || new Date(day).toISOString().slice(0, 10) !== row.flowDate ||
        row.flowVersion.length < 1 || row.flowVersion.length > 32) {
      throw new Error("The archive contains invalid IPDR flow fields.");
    }
    const start = new Date(row.startTime).getTime(), end = new Date(row.endTime).getTime();
    if (start > end) throw new Error("A flow starts after its end time.");
    if (ids.has(row.id)) throw new Error("The archive contains duplicate flow record IDs.");
    ids.add(row.id);
    nasId = recordCount === 1 ? row.nasId : nasId === row.nasId ? nasId : null;
    minTime = Math.min(minTime, end);
    maxTime = Math.max(maxTime, end);
    if (recordCount % 500 === 0) onRecords(recordCount);
  });
  if (!recordCount) throw new Error("The archive contains no flow records.");
  onRecords(recordCount);
  return {
    recordCount, originalBytes, nasId,
    periodStart: new Date(Math.floor((minTime + IST_MS) / WINDOW_MS) * WINDOW_MS - IST_MS),
    periodEnd: new Date(Math.floor((maxTime + IST_MS) / WINDOW_MS) * WINDOW_MS - IST_MS + WINDOW_MS),
  };
}
