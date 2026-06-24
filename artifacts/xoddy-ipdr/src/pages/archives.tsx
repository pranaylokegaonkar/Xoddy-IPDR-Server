import React, { useEffect, useRef, useState } from "react";
import {
  useGetArchives,
  getGetArchivesQueryKey,
  useRunCompression,
  useGetCompressionStatus,
  getGetCompressionStatusQueryKey,
  useDeleteArchive,
  useDeleteArchives,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Archive as ArchiveIcon, FileArchive, Loader2, Zap, Download, Trash2 } from "lucide-react";
import { format, parseISO } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { getToken } from "@/lib/token";

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
  const deleteArchive = useDeleteArchive();
  const deleteArchives = useDeleteArchives();

  // Row selection for bulk delete.
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const toggleRow = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const allSelected = !!archives && archives.length > 0 && selected.size === archives.length;
  const toggleAll = () => {
    if (allSelected) setSelected(new Set());
    else setSelected(new Set((archives ?? []).map((a) => a.id)));
  };

  const refreshArchives = () =>
    queryClient.invalidateQueries({ queryKey: getGetArchivesQueryKey() });

  const handleDownload = async (archive: { id: number; fileName: string }) => {
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}api/archives/${archive.id}/download`, {
        headers: { Authorization: `Bearer ${getToken() ?? ""}` },
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Download failed (${res.status})`);
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = archive.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      window.URL.revokeObjectURL(url);
    } catch (err: any) {
      toast({ title: "Download Error", description: err.message, variant: "destructive" });
    }
  };

  const handleDeleteOne = (archive: { id: number; fileName: string }) => {
    if (!confirm(`Delete archive "${archive.fileName}"?\n\nThis permanently removes the compressed file. This cannot be undone.`)) return;
    deleteArchive.mutate(
      { id: archive.id },
      {
        onSuccess: () => {
          setSelected((prev) => {
            const next = new Set(prev);
            next.delete(archive.id);
            return next;
          });
          refreshArchives();
          toast({ title: "Archive deleted" });
        },
        onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
      },
    );
  };

  const handleDeleteSelected = () => {
    const ids = Array.from(selected);
    if (ids.length === 0) return;
    if (!confirm(`Delete ${ids.length} selected archive(s)?\n\nThis permanently removes the compressed files. This cannot be undone.`)) return;
    deleteArchives.mutate(
      { data: { ids } },
      {
        onSuccess: (res) => {
          setSelected(new Set());
          refreshArchives();
          toast({ title: "Archives deleted", description: `${res.deleted.toLocaleString()} archive(s) removed.` });
        },
        onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" }),
      },
    );
  };

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
        <div className="flex items-center gap-2">
          {selected.size > 0 && (
            <Button
              variant="destructive"
              onClick={handleDeleteSelected}
              disabled={deleteArchives.isPending}
            >
              {deleteArchives.isPending ? (
                <Loader2 className="size-4 mr-2 animate-spin" />
              ) : (
                <Trash2 className="size-4 mr-2" />
              )}
              Delete Selected ({selected.size})
            </Button>
          )}
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
                  <TableHead className="w-[40px]">
                    <Checkbox
                      checked={allSelected}
                      onCheckedChange={toggleAll}
                      aria-label="Select all archives"
                    />
                  </TableHead>
                  <TableHead className="font-mono text-xs">File Name</TableHead>
                  <TableHead className="font-mono text-xs">NAS</TableHead>
                  <TableHead className="font-mono text-xs">Period</TableHead>
                  <TableHead className="font-mono text-xs text-right">Records</TableHead>
                  <TableHead className="font-mono text-xs text-right">Original Size</TableHead>
                  <TableHead className="font-mono text-xs text-right">Compressed</TableHead>
                  <TableHead className="font-mono text-xs text-right">Ratio</TableHead>
                  <TableHead className="font-mono text-xs text-right">Archived At</TableHead>
                  <TableHead className="font-mono text-xs text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={10} className="h-24 text-center">Loading...</TableCell></TableRow>
                ) : archives?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={10} className="h-48 text-center">
                      <div className="flex flex-col items-center justify-center text-muted-foreground">
                        <FileArchive className="size-10 mb-2 opacity-20" />
                        <p>No archives generated yet</p>
                        <p className="text-xs mt-1">Archives are automatically created every 2 hours</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  archives?.map((archive) => (
                    <TableRow key={archive.id} data-state={selected.has(archive.id) ? "selected" : undefined}>
                      <TableCell>
                        <Checkbox
                          checked={selected.has(archive.id)}
                          onCheckedChange={() => toggleRow(archive.id)}
                          aria-label={`Select ${archive.fileName}`}
                        />
                      </TableCell>
                      <TableCell className="font-medium font-mono text-xs text-primary">
                        <span className="flex items-center gap-2">
                          <ArchiveIcon className="size-3 shrink-0" />
                          {archive.fileName}
                        </span>
                      </TableCell>
                      <TableCell className="text-xs">
                        {archive.nasName ? (
                          <span className="flex flex-col">
                            <span className="font-medium">{archive.nasName}</span>
                            {archive.nasIp && <span className="font-mono text-[10px] text-muted-foreground">{archive.nasIp}</span>}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">All</span>
                        )}
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
                      <TableCell className="text-right space-x-1 whitespace-nowrap">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" onClick={() => handleDownload(archive)} title="Download archive">
                          <Download className="size-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDeleteOne(archive)} disabled={deleteArchive.isPending} title="Delete archive">
                          <Trash2 className="size-4" />
                        </Button>
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
