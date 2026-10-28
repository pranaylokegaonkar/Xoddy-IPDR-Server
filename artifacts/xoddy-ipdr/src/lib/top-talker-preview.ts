import type { TopTalker } from "@workspace/api-client-react";

const samples: TopTalker[] = [
  { ip: "192.0.2.10", count: 148250, bytes: 12400000000 },
  { ip: "198.51.100.24", count: 112420, bytes: 8700000000 },
  { ip: "203.0.113.8", count: 88630, bytes: 5300000000 },
  { ip: "192.0.2.42", count: 54180, bytes: 2800000000 },
  { ip: "198.51.100.77", count: 32760, bytes: 1400000000 },
].map((row) => ({ ...row, ispName: "Sample IP — no ISP", asn: null, ispStatus: "not_public" as const }));

export function getTopTalkerDisplay(
  talkers: TopTalker[] | undefined,
  isDevelopment: boolean,
  hostname: string,
  hasError = false,
) {
  const sample = isDevelopment && hostname.toLowerCase().endsWith(".replit.dev") &&
    !hasError && talkers?.length === 0;
  return { talkers: sample ? samples : talkers ?? [], sample };
}
