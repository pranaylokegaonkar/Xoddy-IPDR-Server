import type {
  SystemUserRow,
  NasDeviceRow,
  FlowRecordRow,
  NotificationRow,
  FlowArchiveRow,
  AuditLogRow,
  ArchiveLogRow,
} from "@workspace/db";
import { protocolName } from "./protocols";

const ACTIVE_WINDOW_MS = 1000 * 60 * 30;

export function nasStatus(
  row: Pick<NasDeviceRow, "enabled" | "lastSeenAt">,
): "active" | "inactive" | "never" {
  if (!row.lastSeenAt) return "never";
  if (!row.enabled) return "inactive";
  const age = Date.now() - row.lastSeenAt.getTime();
  return age <= ACTIVE_WINDOW_MS ? "active" : "inactive";
}

export function serializeUser(row: SystemUserRow) {
  return {
    id: row.id,
    username: row.username,
    fullName: row.fullName,
    email: row.email,
    userType: row.userType as "admin" | "operator" | "viewer",
    enabled: row.enabled,
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function serializeAuditLog(row: AuditLogRow) {
  return {
    id: row.id,
    userId: row.userId,
    username: row.username,
    action: row.action,
    detail: row.detail,
    ipAddress: row.ipAddress,
    createdAt: row.createdAt.toISOString(),
  };
}

export function serializeArchiveLog(row: ArchiveLogRow) {
  return {
    id: row.id,
    level: row.level as "info" | "warning" | "error",
    event: row.event,
    message: row.message,
    detail: row.detail,
    createdAt: row.createdAt.toISOString(),
  };
}

export function serializeNas(row: NasDeviceRow, flowCount: number) {
  return {
    id: row.id,
    name: row.name,
    ipAddress: row.ipAddress,
    location: row.location,
    description: row.description,
    flowVersion: row.flowVersion as "v1" | "v5" | "v9" | "ipfix",
    enabled: row.enabled,
    status: nasStatus(row),
    lastSeenAt: row.lastSeenAt ? row.lastSeenAt.toISOString() : null,
    flowCount,
    createdAt: row.createdAt.toISOString(),
  };
}

export function serializeFlow(row: FlowRecordRow, nasName: string) {
  return {
    id: row.id,
    nasId: row.nasId,
    nasName,
    srcIp: row.srcIp,
    dstIp: row.dstIp,
    srcNatIp: row.srcNatIp,
    dstNatIp: row.dstNatIp,
    srcPort: row.srcPort,
    dstPort: row.dstPort,
    protocol: row.protocol,
    protocolName: protocolName(row.protocol),
    bytes: row.bytes,
    packets: row.packets,
    flowVersion: row.flowVersion,
    startTime: row.startTime.toISOString(),
    endTime: row.endTime.toISOString(),
    flowDate: row.flowDate,
  };
}

export function serializeNotification(row: NotificationRow) {
  return {
    id: row.id,
    type: row.type as "no_records" | "nas_disabled" | "system",
    severity: row.severity as "info" | "warning" | "critical",
    title: row.title,
    message: row.message,
    nasId: row.nasId,
    read: row.read,
    createdAt: row.createdAt.toISOString(),
  };
}

export function serializeArchive(row: FlowArchiveRow) {
  return {
    id: row.id,
    fileName: row.fileName,
    nasId: row.nasId,
    nasName: row.nasName,
    nasIp: row.nasIp,
    recordCount: row.recordCount,
    originalBytes: row.originalBytes,
    compressedBytes: row.compressedBytes,
    periodStart: row.periodStart.toISOString(),
    periodEnd: row.periodEnd.toISOString(),
    createdAt: row.createdAt.toISOString(),
  };
}
