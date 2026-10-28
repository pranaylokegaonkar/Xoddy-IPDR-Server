import os from "node:os";
import { setTimeout as delay } from "node:timers/promises";

export interface CpuUsage {
  percent: number;
  processPercent: number;
  logicalCpus: number;
}

export interface CpuSnapshot {
  total: number;
  idle: number;
  logicalCpus: number;
  processMicroseconds: number;
  atNs: bigint;
}

function snapshot(): CpuSnapshot {
  const cpus = os.cpus();
  const usage = process.cpuUsage();
  return {
    total: cpus.reduce((sum, cpu) =>
      sum + cpu.times.user + cpu.times.nice + cpu.times.sys + cpu.times.idle + cpu.times.irq, 0),
    idle: cpus.reduce((sum, cpu) => sum + cpu.times.idle, 0),
    logicalCpus: cpus.length,
    processMicroseconds: usage.user + usage.system,
    atNs: process.hrtime.bigint(),
  };
}

export function calculateCpuUsage(before: CpuSnapshot, after: CpuSnapshot): CpuUsage | null {
  const total = after.total - before.total;
  const idle = after.idle - before.idle;
  const elapsedUs = Number(after.atNs - before.atNs) / 1000;
  const processUs = after.processMicroseconds - before.processMicroseconds;
  if (before.logicalCpus !== after.logicalCpus || after.logicalCpus < 1 ||
      ![total, idle, elapsedUs, processUs].every(Number.isFinite) ||
      total <= 0 || idle < 0 || idle > total || elapsedUs <= 0 || processUs < 0) {
    return null;
  }
  return {
    percent: ((total - idle) / total) * 100,
    // Unlike the host-wide average, 100% here means one fully occupied core.
    // Multiple Node/worker threads may legitimately consume more than 100%.
    processPercent: (processUs / elapsedUs) * 100,
    logicalCpus: after.logicalCpus,
  };
}

/** Sample on demand without blocking the event loop or accessing the database. */
export class CpuUsageSampler {
  private pending: Promise<CpuUsage | null> | undefined;
  private cached: CpuUsage | null = null;
  private expiresAt = 0;

  constructor(
    private capture = snapshot,
    private wait: () => Promise<unknown> = () => delay(1000),
    private now = Date.now,
  ) {}

  async read(): Promise<CpuUsage | null> {
    if (this.pending) return this.pending;
    if (this.cached && this.now() < this.expiresAt) return this.cached;
    const before = this.capture();
    this.pending = (async () => {
      await this.wait();
      this.cached = calculateCpuUsage(before, this.capture());
      this.expiresAt = this.now() + 1000;
      return this.cached;
    })();
    try {
      return await this.pending;
    } finally {
      this.pending = undefined;
    }
  }
}
