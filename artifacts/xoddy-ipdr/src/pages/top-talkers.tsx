import { useState } from "react";
import { useGetTopTalkers, getGetTopTalkersQueryKey, useGetIpNetworks, getGetIpNetworksQueryKey } from "@workspace/api-client-react";
import { Activity, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { getTopTalkerDisplay } from "@/lib/top-talker-preview";

function formatBytes(bytes: number) {
  if (!bytes) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB", "PB", "EB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(2)} ${units[index]}`;
}

export default function TopTalkers() {
  const [requested, setRequested] = useState(false);
  // The traffic aggregation only runs through the explicit button action.
  const query = useGetTopTalkers({
    query: {
      queryKey: getGetTopTalkersQueryKey(),
      enabled: false,
      retry: false,
      gcTime: 0,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
    },
  });
  const talkers = requested && !query.isFetching && !query.isError ? query.data : undefined;
  const networkParams = { ips: talkers?.map((row) => row.ip).join(",") ?? "" };
  const networks = useGetIpNetworks(networkParams, {
    query: {
      queryKey: getGetIpNetworksQueryKey(networkParams),
      enabled: !!talkers?.some((row) => row.ispStatus === "pending"),
      retry: false,
      refetchOnWindowFocus: false,
      refetchInterval: (state) => state.state.status !== "error" &&
        state.state.data?.some((row) => row.ispStatus === "pending") ? 2000 : false,
    },
  });
  const enriched = talkers?.map((row) => {
    const combined = { ...row, ...(row.ispStatus === "pending" ? networks.data?.find((item) => item.ip === row.ip) : undefined) };
    return networks.isError && combined.ispStatus === "pending"
      ? { ...combined, ispName: "ISP lookup unavailable", asn: null, ispStatus: "unavailable" as const }
      : combined;
  });
  const display = getTopTalkerDisplay(enriched, import.meta.env.DEV, window.location.hostname, query.isError);

  return (
    <div className="flex-1 overflow-auto p-4 md:p-8">
      <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Top Talkers</h1>
          <p className="mt-1 text-sm text-muted-foreground">Highest bandwidth source IPs in the last 24 hours. Calculated only on request.</p>
        </div>
        <Button disabled={query.isFetching} onClick={() => { setRequested(true); void query.refetch(); }}>
          {query.isFetching && <Loader2 className="mr-2 size-4 animate-spin" />}
          {query.isFetching ? "Analyzing…" : "Analyze Today's Data"}
        </Button>
      </div>
      <Card>
        <CardHeader className="border-b border-border/50 bg-muted/20">
          <CardTitle className="text-base">Results {requested && display.sample && <Badge variant="outline" className="ml-2">Sample</Badge>}</CardTitle>
          {requested && display.sample && <CardDescription>Sample data (Replit preview only)</CardDescription>}
        </CardHeader>
        <CardContent className="p-0" aria-live="polite" aria-busy={query.isFetching}>
          {!requested ? (
            <div className="p-10 text-center text-sm text-muted-foreground"><Activity className="mx-auto mb-3 size-8 opacity-40" />Click Analyze Today's Data to calculate Top Talkers.</div>
          ) : query.isFetching ? (
            <p className="p-10 text-center text-sm text-muted-foreground">Analyzing traffic totals…</p>
          ) : query.isError ? (
            <p role="alert" className="p-8 text-center text-sm text-destructive">Unable to analyze Top Talkers. Click Analyze Today's Data to try again.</p>
          ) : display.talkers.length === 0 ? (
            <p className="p-10 text-center text-sm text-muted-foreground">No talker data available in the last 24 hours.</p>
          ) : (
            <div className="divide-y divide-border">
              {display.talkers.map((talker, index) => (
                <div key={talker.ip} className="flex items-center justify-between gap-3 p-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded bg-primary/10 text-xs font-bold text-primary">{index + 1}</span>
                    <div className="min-w-0">
                      <p className="break-all font-mono text-sm font-medium">{talker.ip}</p>
                      <p className="mt-1 break-words text-xs text-muted-foreground" title="Network organization, not the individual subscriber">
                        {talker.ispName ?? "ISP lookup unavailable"}{talker.asn != null && ` · AS${talker.asn}`}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">{talker.count.toLocaleString()} flows</p>
                    </div>
                  </div>
                  <Badge variant="secondary" className="shrink-0 font-mono">{formatBytes(talker.bytes)}</Badge>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
