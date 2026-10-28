import { BlockList, isIP } from "node:net";

export interface NetworkInfo {
  ispName: string;
  asn: number | null;
  ispStatus: "resolved" | "pending" | "not_public" | "unavailable";
}

const localRanges = [
  ["Sample IP — no ISP", ["192.0.2.0/24", "198.51.100.0/24", "203.0.113.0/24", "2001:db8::/32", "3fff::/20"]],
  ["Private network", ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "fc00::/7"]],
  ["Loopback address", ["127.0.0.0/8", "::1/128"]],
  ["Link-local network", ["169.254.0.0/16", "fe80::/10"]],
  ["Shared address (CGNAT)", ["100.64.0.0/10"]],
  ["Special-use address", ["0.0.0.0/8", "192.0.0.0/24", "192.88.99.0/24", "198.18.0.0/15", "224.0.0.0/4", "240.0.0.0/4", "2001::/23"]],
] as const;

const localBlocks = localRanges.map(([label, ranges]) => {
  const block = new BlockList();
  for (const cidr of ranges) {
    const [address, bits] = cidr.split("/");
    block.addSubnet(address, Number(bits), isIP(address) === 6 ? "ipv6" : "ipv4");
  }
  return { label, block };
});
const globalV6 = new BlockList();
globalV6.addSubnet("2000::", 3, "ipv6");
const pending: NetworkInfo = { ispName: "Looking up network…", asn: null, ispStatus: "pending" };
const unavailable: NetworkInfo = { ispName: "ISP lookup unavailable", asn: null, ispStatus: "unavailable" };
const HOUR = 3600000;
function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isNetwork(value: unknown): value is { asn: number; holder: string } {
  return isObject(value) && typeof value.asn === "number" && Number.isInteger(value.asn) &&
    value.asn > 0 && value.asn <= 4294967295 &&
    typeof value.holder === "string" && value.holder.trim().length > 0;
}

export function parseNetworkIps(value: unknown): string[] | null {
  if (typeof value !== "string" || !value.length || value.length > 500) return null;
  const ips = [...new Set(value.split(",").map((ip) => ip.trim()))];
  return ips.length <= 10 && ips.every((ip) => isIP(ip) !== 0) ? ips : null;
}

// Returns immediately: external lookups must never delay dashboard flow totals.
// Only public addresses go to RIPEstat. No credentials or subscriber data are sent.
export class IpNetworkLookup {
  private cache = new Map<string, { info: NetworkInfo; expires: number }>();
  private active = 0;

  constructor(private fetcher: typeof fetch = fetch, private now = Date.now) {}

  get(ip: string): NetworkInfo {
    const version = isIP(ip);
    if (!version || ip.includes("%")) return { ispName: "Invalid or scoped IP address", asn: null, ispStatus: "not_public" };
    const family = version === 6 ? "ipv6" : "ipv4";
    for (const { label, block } of localBlocks) {
      if (block.check(ip, family)) return { ispName: label, asn: null, ispStatus: "not_public" };
    }
    if (version === 6 && !globalV6.check(ip, "ipv6")) {
      return { ispName: "Special-use address", asn: null, ispStatus: "not_public" };
    }
    const cached = this.cache.get(ip);
    if (cached && cached.expires > this.now()) return cached.info;
    // Let subsequent dashboard polls pick up remaining addresses; no unbounded queue.
    if (this.active >= 2) return pending;
    if (this.cache.size >= 1000 && !this.cache.has(ip)) {
      for (const [key, entry] of this.cache) {
        if (entry.info.ispStatus !== "pending") { this.cache.delete(key); break; }
      }
    }
    this.cache.set(ip, { info: pending, expires: Infinity });
    this.active++;
    void this.resolve(ip);
    return pending;
  }

  private async resolve(ip: string) {
    let info = unavailable;
    let ttl = 5 * 60000;
    try {
      const response = await this.fetcher(
        `https://stat.ripe.net/data/prefix-overview/data.json?resource=${encodeURIComponent(ip)}`,
        { signal: AbortSignal.timeout(2500), headers: { Accept: "application/json" } },
      );
      if (!response.ok) throw new Error("Network lookup HTTP failure");
      const body: unknown = await response.json();
      if (!isObject(body) || body.status !== "ok" || !isObject(body.data) ||
          !Array.isArray(body.data.asns) || body.data.asns.length > 100) {
        throw new Error("Invalid network lookup response");
      }
      const network = body.data.asns.find(isNetwork);
      if (network) {
        info = { ispName: network.holder.trim().slice(0, 200), asn: network.asn, ispStatus: "resolved" };
        ttl = 24 * HOUR;
      } else if (body.data.asns.length === 0) {
        info = { ispName: "ISP/network not found", asn: null, ispStatus: "unavailable" };
        ttl = HOUR;
      }
    } catch {
      // Fail explicitly in the card; cache failures too so outages do not trigger a flood.
    } finally {
      this.cache.set(ip, { info, expires: this.now() + ttl });
      this.active--;
    }
  }
}

export const ipNetworkLookup = new IpNetworkLookup();
