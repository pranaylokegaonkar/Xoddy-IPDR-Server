import ExcelJS from "exceljs";
import { protocolName } from "./protocols";

export interface ExportRow {
  id: number;
  nasName: string;
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
  flowDate: string;
}

const HEADERS = [
  "ID",
  "NAS",
  "Src IP",
  "Dst IP",
  "Src NAT IP",
  "Dst NAT IP",
  "Src Port",
  "Dst Port",
  "Protocol",
  "Bytes",
  "Packets",
  "Version",
  "Start Time",
  "End Time",
  "Date",
];

function rowValues(r: ExportRow): (string | number)[] {
  return [
    r.id,
    r.nasName,
    r.srcIp,
    r.dstIp,
    r.srcNatIp ?? "",
    r.dstNatIp ?? "",
    r.srcPort,
    r.dstPort,
    protocolName(r.protocol),
    r.bytes,
    r.packets,
    r.flowVersion,
    r.startTime.toISOString(),
    r.endTime.toISOString(),
    r.flowDate,
  ];
}

export function buildText(rows: ExportRow[]): string {
  const lines = [HEADERS.join("\t")];
  for (const r of rows) {
    lines.push(rowValues(r).join("\t"));
  }
  return lines.join("\n");
}

export async function buildExcel(rows: ExportRow[]): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Xoddy IPDR Server";
  const ws = wb.addWorksheet("IPDR Records");
  ws.addRow(HEADERS);
  ws.getRow(1).font = { bold: true };
  for (const r of rows) {
    ws.addRow(rowValues(r));
  }
  ws.columns.forEach((col) => {
    col.width = 16;
  });
  const buf = await wb.xlsx.writeBuffer();
  return Buffer.from(buf);
}
