import { useEffect, useState } from "react";
import {
  useSearchOldSearchSession, useExportOldSearchSession,
  useGetArchiveNasOptions, getGetArchiveNasOptionsQueryKey,
  type OldSearchSession, type FlowSearch,
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { FileSpreadsheet, FileText, Loader2, Search, RotateCcw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import {
  apiErrorMessage, emptyOldFilters, filtersToPayload, fmtIst, nf, PAGE_SIZE, type OldFilters,
} from "./old-search-utils";

type Applied = Omit<FlowSearch, "page" | "pageSize">;

interface Props {
  session: OldSearchSession;
  onBusyChange: (busy: boolean) => void;
  onReleasedByExport: () => void;
}

export function OldSearchWorkspace({ session, onBusyChange, onReleasedByExport }: Props) {
  const { toast } = useToast();
  const [filters, setFilters] = useState<OldFilters>(emptyOldFilters);
  const [applied, setApplied] = useState<Applied | null>(null);
  const [page, setPage] = useState(1);
  const [releaseAfter, setReleaseAfter] = useState(false);

  const search = useSearchOldSearchSession();
  const exporter = useExportOldSearchSession();
  const operationPending = search.isPending || exporter.isPending;
  useEffect(() => { onBusyChange(operationPending); }, [operationPending, onBusyChange]);
  const { data: nasOptions } = useGetArchiveNasOptions({
    query: { queryKey: getGetArchiveNasOptionsQueryKey(), staleTime: 30000 },
  });

  const run = (criteria: Applied, p: number) => {
    if (operationPending) return;
    search.mutate(
      { id: session.id, data: { ...criteria, page: p, pageSize: PAGE_SIZE } },
      { onSuccess: () => { setApplied(criteria); setPage(p); } },
    );
  };

  const onSubmit = (e: React.FormEvent) => { e.preventDefault(); run(filtersToPayload(filters), 1); };

  const clearSearch = () => {
    if (operationPending) return;
    setFilters({ ...emptyOldFilters });
    setApplied(null);
    setPage(1);
    setReleaseAfter(false);
    search.reset();
    exporter.reset();
  };

  const doExport = (fmt: "text" | "excel") => {
    if (!applied || operationPending) return;
    const body = { ...applied, format: fmt, ...(releaseAfter ? { releaseAfterExport: true } : {}) };
    exporter.mutate({ id: session.id, data: body }, {
      onSuccess: (blob) => {
        const b = blob instanceof Blob ? blob : new Blob([blob as BlobPart]);
        const url = URL.createObjectURL(b);
        const a = document.createElement("a");
        a.href = url;
        a.download = fmt === "text" ? "ipdr-old-search.txt" : "ipdr-old-search.xlsx";
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        toast({ title: "Export sent", description: releaseAfter ? "Automatic release requested. Workspace status will confirm completion." : "Your file is downloading." });
        if (releaseAfter) onReleasedByExport();
      },
      onError: (err) => toast({ title: "Export failed", description: apiErrorMessage(err, "Export failed"), variant: "destructive" }),
    });
  };

  const data = search.isError ? undefined : search.data;
  const total = data?.total ?? 0;
  const overLimit = total > session.exportLimit;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const set = (k: keyof OldFilters) => (e: React.ChangeEvent<HTMLInputElement>) => setFilters({ ...filters, [k]: e.target.value });

  return (
    <>
      <Card className="shadow-sm border-border">
        <CardHeader className="pb-3 flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
          <div className="space-y-1.5">
          <CardTitle className="text-lg">Filter Criteria</CardTitle>
          <CardDescription className="text-xs">
            Date and time filters apply daily in IST and narrow within the workspace window; the window itself is always enforced.
            Exports retain the original stored flow dates and UTC ISO timestamps.
          </CardDescription>
          </div>
          <Button type="button" variant="outline" size="sm" onClick={clearSearch} disabled={operationPending}
            title="Clear filters and results without releasing the temporary workspace">
            <RotateCcw className="size-4 mr-2" /> Clear Search
          </Button>
        </CardHeader>
        <CardContent>
          <form onSubmit={onSubmit} className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
            <F label="Source IP"><Input value={filters.srcIp} onChange={set("srcIp")} placeholder="e.g. 192.168.1.1" /></F>
            <F label="Destination IP"><Input value={filters.dstIp} onChange={set("dstIp")} placeholder="e.g. 8.8.8.8" /></F>
            <F label="Source NAT IP"><Input value={filters.srcNatIp} onChange={set("srcNatIp")} placeholder="Translated Source" /></F>
            <F label="Destination NAT IP"><Input value={filters.dstNatIp} onChange={set("dstNatIp")} placeholder="Translated Dest" /></F>
            <F label="NAS Device">
              <Select value={filters.nasId} onValueChange={(v) => setFilters({ ...filters, nasId: v })}>
                <SelectTrigger><SelectValue placeholder="All Devices" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Devices</SelectItem>
                  {nasOptions?.map((n) => <SelectItem key={n.id} value={String(n.id)}>{n.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </F>
            <F label="Date From"><Input type="date" value={filters.dateFrom} onChange={set("dateFrom")} /></F>
            <F label="Date To"><Input type="date" value={filters.dateTo} onChange={set("dateTo")} /></F>
            <F label="Time From"><Input type="time" value={filters.startTime} onChange={set("startTime")} /></F>
            <F label="Time To"><Input type="time" value={filters.endTime} onChange={set("endTime")} /></F>
            <div className="flex items-end">
              <Button type="submit" className="w-full" disabled={search.isPending || exporter.isPending}>
                {search.isPending ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Search className="size-4 mr-2" />} Search Workspace
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      <Card className="flex flex-col shadow-sm border-border min-h-[400px]">
        <CardHeader className="py-3 px-4 border-b border-border bg-muted/30 flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <div>
            <CardTitle className="text-base font-semibold">Results</CardTitle>
            {data && (
              <CardDescription className="text-xs">
                Found {nf.format(total)} records (page {data.page} of {pages}). Pagination and export use the last submitted filters.
              </CardDescription>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-xs cursor-pointer" title="The server releases the workspace after it finishes sending the file. Whether your browser saved it cannot be verified. Original archives are never deleted.">
              <Checkbox checked={releaseAfter} disabled={operationPending} onCheckedChange={(v) => setReleaseAfter(v === true)} />
              Release after export
            </label>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => doExport("text")} disabled={!data || total === 0 || overLimit || operationPending}>
              <FileText className="size-3 mr-1" /> Text Export
            </Button>
            <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => doExport("excel")} disabled={!data || total === 0 || overLimit || operationPending}>
              {exporter.isPending ? <Loader2 className="size-3 mr-1 animate-spin" /> : <FileSpreadsheet className="size-3 mr-1" />} Excel Export
            </Button>
          </div>
        </CardHeader>
        {(overLimit || releaseAfter) && (
          <div className="px-4 py-2 text-xs border-b border-border space-y-1">
            {overLimit && <p className="text-destructive">{nf.format(total)} matches exceed the {nf.format(session.exportLimit)}-row export limit. Narrow filters to export; files are never truncated.</p>}
            {releaseAfter && <p className="text-muted-foreground">The workspace will be released once the server sends the file. The app cannot confirm your browser saved it. Original archives are untouched.</p>}
          </div>
        )}
        <CardContent className="p-0 flex-1 overflow-auto">
          <Table>
            <TableHeader className="sticky top-0 bg-background z-10 shadow-[0_1px_0_0_hsl(var(--border))]">
              <TableRow>
                {["Time", "NAS", "Src IP:Port", "Dst IP:Port", "Src NAT IP", "Dst NAT IP", "Proto"].map((h) => (
                  <TableHead key={h} className="whitespace-nowrap font-mono text-xs">{h}</TableHead>
                ))}
                <TableHead className="whitespace-nowrap font-mono text-xs text-right">Bytes</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {search.isPending ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <TableRow key={i}><TableCell colSpan={8} className="py-3"><Skeleton className="h-4 w-full" /></TableCell></TableRow>
                ))
              ) : search.isError ? (
                <TableRow><TableCell colSpan={8} className="h-32 text-center font-sans">
                  <p className="text-destructive text-sm">{apiErrorMessage(search.error, "Search failed")}</p>
                  {applied && <Button size="sm" variant="outline" className="mt-3" onClick={() => run(applied, page)}>Retry last search</Button>}
                </TableCell></TableRow>
              ) : data && data.records.length > 0 ? (
                data.records.map((row) => (
                  <TableRow key={row.id} className="text-xs font-mono">
                    <TableCell className="whitespace-nowrap">{fmtIst(row.startTime)}</TableCell>
                    <TableCell className="font-sans font-medium">{row.nasName}</TableCell>
                    <TableCell>{row.srcIp}:{row.srcPort}</TableCell>
                    <TableCell>{row.dstIp}:{row.dstPort}</TableCell>
                    <TableCell className="text-muted-foreground">{row.srcNatIp || "-"}</TableCell>
                    <TableCell className="text-muted-foreground">{row.dstNatIp || "-"}</TableCell>
                    <TableCell><Badge variant="outline" className="text-[10px] h-5 px-1 py-0">{row.protocolName}</Badge></TableCell>
                    <TableCell className="text-right">{row.bytes}</TableCell>
                  </TableRow>
                ))
              ) : (
                <TableRow><TableCell colSpan={8} className="h-32 text-center text-muted-foreground font-sans">
                  {data ? "No flows in this workspace match your criteria" : "Workspace ready. Enter criteria and click Search Workspace."}
                </TableCell></TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
        {data && total > 0 && applied && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/20">
            <div className="text-xs text-muted-foreground">
              Showing {(page - 1) * PAGE_SIZE + 1} to {Math.min(page * PAGE_SIZE, total)} of {nf.format(total)}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={page <= 1 || operationPending} onClick={() => run(applied, page - 1)}>Previous</Button>
              <Button variant="outline" size="sm" disabled={page >= pages || operationPending} onClick={() => run(applied, page + 1)}>Next</Button>
            </div>
          </div>
        )}
      </Card>
    </>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label>{label}</Label>{children}</div>;
}
