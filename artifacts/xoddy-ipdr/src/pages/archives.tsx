import React, { useEffect, useRef, useState } from "react";
import {
  useGetArchives,
  getGetArchivesQueryKey,
  useRunCompression,
  useGetCompressionStatus,
  getGetCompressionStatusQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Archive as ArchiveIcon, FileArchive, Loader2, Zap } from "lucide-react";
import { format, parseISO } from "date-fns";
import { useToast } from "@/hooks/use-toast";

export default function Archives() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const { data: archives, isLoading } = useGetArchives({ query: { queryKey: getGetArchivesQueryKey() } });

  // Live compression status. Poll fast while running, slow when idle so we still
  // notice a scheduled (every-2h) run kicking off without the user clicking.
  const { data: status } = useGetCompressionStatus({
    query: {
      queryKey: getGetCompressionStatusQueryKey(),
      refetchInterval: (query) =>
        (query.state.data as { running?: boolean } | undefined)?.running ? 1000 : 5000,
    },
  });

  // When a run transitions running -> not running, refresh the archive list.
  const wasRunning = useRef(false);
  useEffect(() => {
    if (wasRunning.current && status && !status.running) {
      queryClient.invalidateQueries({ queryKey: getGetArchivesQueryKey() });
    }
    wasRunning.current = !!status?.running;
  }, [status?.running, queryClient]);

  const runCompression = useRunCompression();

  // Live countdown to the next IST 2-hour window boundary (when the current
  // window closes and becomes eligible to be archived).
  const [nowMs, setNowMs] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;
  const WINDOW_MS = 2 * 60 * 60 * 1000;
  const nextBoundaryMs =
    (Math.floor((nowMs + IST_OFFSET_MS) / WINDOW_MS) + 1) * WINDOW_MS - IST_OFFSET_MS;
  const msToNext = Math.max(0, nextBoundaryMs - nowMs);
  const formatCountdown = (ms: number) => {
    const total = Math.floor(ms / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${h}h ${pad(m)}m ${pad(s)}s`;
  };

  // Compact duration for elapsed/remaining (e.g. "2h 05m", "3m 12s", "8s").
  const formatDuration = (seconds: number) => {
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
    if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
    return `${sec}s`;
  };

  const handleRunCompression = () => {
    runCompression.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetArchivesQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetCompressionStatusQueryKey() });
        toast({ title: "Compression Started", description: "Background job has been triggered." });
      },
      onError: (err: any) => {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      }
    });
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const calculateRatio = (original: number, compressed: number) => {
    if (original === 0) return 0;
    return ((1 - (compressed / original)) * 100).toFixed(1);
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-8 pt-8 pb-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight font-sans">Data Archives</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Compressed historical flow records (2-hour IST batches). Current window closes in{" "}
            <span className="font-mono font-medium text-foreground tabular-nums">{formatCountdown(msToNext)}</span>
            {" "}(archived shortly after).
          </p>
        </div>
        <Button
          onClick={handleRunCompression}
          disabled={runCompression.isPending || status?.running}
        >
          {status?.running ? (
            <Loader2 className="size-4 mr-2 animate-spin" />
          ) : (
            <Zap className="size-4 mr-2" />
          )}
          {status?.running ? "Compressing…" : "Compress Now"}
        </Button>
      </div>

      {status?.running && (
        <div className="px-8 pb-4">
          <Card className="border-primary/30 bg-primary/5 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                  <Loader2 className="size-4 text-primary animate-spin shrink-0" />
                  <span className="text-sm font-medium">Compressing</span>
                  <span className="font-mono text-xs text-primary truncate">
                    {status.currentFileName ?? "preparing…"}
                  </span>
                  {status.currentPeriodStart && status.currentPeriodEnd && (
                    <span className="text-xs text-muted-foreground hidden sm:inline">
                      ({format(parseISO(status.currentPeriodStart), "MMM d HH:mm")} –{" "}
                      {format(parseISO(status.currentPeriodEnd), "HH:mm")})
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground tabular-nums">
                  <span>
                    Started{" "}
                    <span className="font-medium text-foreground">
                      {status.elapsedSeconds != null ? `${formatDuration(status.elapsedSeconds)} ago` : "just now"}
                    </span>
                  </span>
                  <span>
                    Remaining{" "}
                    <span className="font-medium text-foreground">
                      {status.etaSeconds != null ? `~${formatDuration(status.etaSeconds)}` : "estimating…"}
                    </span>
                  </span>
                  <span>
                    <span className="font-medium text-foreground">{status.completedCount}</span> done
                  </span>
                </div>
              </div>
              <div className="mt-3 h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.max(2, status.progressPercent ?? 0))}%` }}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex-1 overflow-auto px-8 pb-8">
        <Card className="shadow-sm border-border">
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow>
                  <TableHead className="font-mono text-xs">File Name</TableHead>
                  <TableHead className="font-mono text-xs">Period</TableHead>
                  <TableHead className="font-mono text-xs text-right">Records</TableHead>
                  <TableHead className="font-mono text-xs text-right">Original Size</TableHead>
                  <TableHead className="font-mono text-xs text-right">Compressed</TableHead>
                  <TableHead className="font-mono text-xs text-right">Ratio</TableHead>
                  <TableHead className="font-mono text-xs text-right">Archived At</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={7} className="h-24 text-center">Loading...</TableCell></TableRow>
                ) : archives?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-48 text-center">
                      <div className="flex flex-col items-center justify-center text-muted-foreground">
                        <FileArchive className="size-10 mb-2 opacity-20" />
                        <p>No archives generated yet</p>
                        <p className="text-xs mt-1">Archives are automatically created every 2 hours</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  archives?.map((archive) => (
                    <TableRow key={archive.id}>
                      <TableCell className="font-medium font-mono text-xs text-primary flex items-center gap-2">
                        <ArchiveIcon className="size-3" />
                        {archive.fileName}
                      </TableCell>
                      <TableCell className="text-xs">
                        {format(parseISO(archive.periodStart), "HH:mm")} - {format(parseISO(archive.periodEnd), "HH:mm")}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">{archive.recordCount.toLocaleString()}</TableCell>
                      <TableCell className="text-right text-xs">{formatBytes(archive.originalBytes)}</TableCell>
                      <TableCell className="text-right font-medium text-xs">{formatBytes(archive.compressedBytes)}</TableCell>
                      <TableCell className="text-right">
                        <Badge variant="outline" className="text-[10px] bg-green-50 text-green-700 dark:bg-green-950 dark:text-green-400 border-green-200 dark:border-green-800">
                          {calculateRatio(archive.originalBytes, archive.compressedBytes)}% reduction
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {format(parseISO(archive.createdAt), "MMM d, yyyy HH:mm")}
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
