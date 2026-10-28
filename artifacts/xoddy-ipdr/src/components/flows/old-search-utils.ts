import type { FlowSearch, OldSearchSession } from "@workspace/api-client-react";

export interface OldFilters {
  srcIp: string;
  dstIp: string;
  srcNatIp: string;
  dstNatIp: string;
  nasId: string;
  dateFrom: string;
  dateTo: string;
  startTime: string;
  endTime: string;
}

export const emptyOldFilters: OldFilters = {
  srcIp: "", dstIp: "", srcNatIp: "", dstNatIp: "", nasId: "all",
  dateFrom: "", dateTo: "", startTime: "", endTime: "",
};

export function filtersToPayload(f: OldFilters): Omit<FlowSearch, "page" | "pageSize"> {
  const p: Omit<FlowSearch, "page" | "pageSize"> = {};
  if (f.srcIp.trim()) p.srcIp = f.srcIp.trim();
  if (f.dstIp.trim()) p.dstIp = f.dstIp.trim();
  if (f.srcNatIp.trim()) p.srcNatIp = f.srcNatIp.trim();
  if (f.dstNatIp.trim()) p.dstNatIp = f.dstNatIp.trim();
  if (f.nasId && f.nasId !== "all") p.nasId = parseInt(f.nasId, 10);
  if (f.dateFrom) p.dateFrom = f.dateFrom;
  if (f.dateTo) p.dateTo = f.dateTo;
  if (f.startTime) p.startTime = f.startTime;
  if (f.endTime) p.endTime = f.endTime;
  return p;
}

export function apiErrorMessage(err: unknown, fallback = "Request failed"): string {
  if (!err) return fallback;
  const data = (err as { data?: unknown }).data;
  if (data && typeof data === "object" && typeof (data as { error?: unknown }).error === "string") {
    return (data as { error: string }).error;
  }
  const status = (err as { status?: number }).status;
  if (typeof data === "string" && !/<[a-z!]/i.test(data) && data.length < 300) return data;
  return status ? `${fallback} (HTTP ${status})` : fallback;
}

export function errorStatus(err: unknown): number | undefined {
  return (err as { status?: number } | null)?.status;
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return "0 B";
  const u = ["B", "KiB", "MiB", "GiB", "TiB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < u.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

export const nf = new Intl.NumberFormat("en-IN");

const istFmt = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
});
export function fmtIst(iso: string | null | undefined): string {
  if (!iso) return "-";
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "-" : `${istFmt.format(d)} IST`;
}

export function istToIso(date: string, time: string): string | null {
  if (!date) return null;
  const t = time || "00:00";
  const iso = `${date}T${t.length === 5 ? `${t}:00` : t}+05:30`;
  return Number.isNaN(new Date(iso).getTime()) ? null : iso;
}

export const ACTIVE_STATES: OldSearchSession["state"][] = ["preparing", "ready"];
export const isActive = (s?: OldSearchSession | null) => !!s && ACTIVE_STATES.includes(s.state);

export const LAST_SESSION_KEY = "xoddy.oldSearch.lastSessionId";
export const MAX_ARCHIVES = 100;
export const MAX_ORIGINAL_BYTES = 512 * 1024 * 1024;
export const MAX_RECORDS = 1_000_000;
export const PAGE_SIZE = 50;
