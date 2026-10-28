import { useMemo, useState } from "react";
import {
  useFindOldSearchArchives, usePrepareOldSearchSession,
  useGetArchiveNasOptions, getGetArchiveNasOptionsQueryKey,
  type ArchiveRangeInput, type OldSearchSession,
} from "@workspace/api-client-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Archive, Loader2, Lock, Search } from "lucide-react";
import {
  apiErrorMessage, fmtIst, formatBytes, istToIso, nf,
  MAX_ARCHIVES, MAX_ORIGINAL_BYTES, MAX_RECORDS,
} from "./old-search-utils";

export function OldSearchArchivePicker({ onPrepared }: { onPrepared: (s: OldSearchSession) => void }) {
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("00:00");
  const [endDate, setEndDate] = useState("");
  const [endTime, setEndTime] = useState("23:59");
  const [nasId, setNasId] = useState("all");
  const [range, setRange] = useState<ArchiveRangeInput | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);

  const find = useFindOldSearchArchives();
  const prepare = usePrepareOldSearchSession();
  const { data: nasOptions, isLoading: nasLoading } = useGetArchiveNasOptions({
    query: { queryKey: getGetArchiveNasOptionsQueryKey(), staleTime: 30000 },
  });

  const startIso = istToIso(startDate, startTime);
  const endIso = istToIso(endDate, endTime);
  const rangeError = startIso && endIso && new Date(endIso) <= new Date(startIso)
    ? "End must be after start." : null;

  const archives = find.data;
  const chosen = useMemo(() => (archives ?? []).filter((a) => selected.has(a.id)), [archives, selected]);
  const totalBytes = chosen.reduce((s, a) => s + a.originalBytes, 0);
  const totalRecords = chosen.reduce((s, a) => s + a.recordCount, 0);
  const overArchives = chosen.length > MAX_ARCHIVES;
  const overBytes = totalBytes > MAX_ORIGINAL_BYTES;
  const overRecords = totalRecords > MAX_RECORDS;
  const tooLarge = overArchives || overBytes || overRecords;

  const handleFind = (e: React.FormEvent) => {
    e.preventDefault();
    if (!startIso || !endIso || rangeError) return;
    const body: ArchiveRangeInput = { startAt: startIso, endAt: endIso };
    if (nasId !== "all") body.nasId = Number(nasId);
    setSelected(new Set());
    find.mutate({ data: body }, { onSuccess: () => setRange(body) });
  };

  const toggle = (id: number) => setSelected((prev) => {
    const n = new Set(prev);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });
  const allSelected = !!archives?.length && archives.every((a) => selected.has(a.id));

  const doPrepare = () => {
    if (!range) return;
    prepare.mutate(
      { data: { ...range, archiveIds: chosen.map((a) => a.id) } },
      { onSuccess: (s) => { setConfirmOpen(false); onPrepared(s); }, onError: () => setConfirmOpen(false) },
    );
  };

  return (
    <div className="space-y-6">
      <Card className="shadow-sm border-border">
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Archive Window (IST)</CardTitle>
          <CardDescription className="text-xs max-w-3xl">
            Matching uses each flow's <span className="font-medium text-foreground">end time</span>. Archives are
            listed when their window overlaps your range, and the temporary workspace keeps only flows whose end
            time falls inside it. A flow that started before your start but ended inside it is included.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleFind} className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-6 gap-4 items-end">
            <div className="space-y-2"><Label htmlFor="os-sd">Start date</Label>
              <Input id="os-sd" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="os-st">Start time</Label>
              <Input id="os-st" type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="os-ed">End date</Label>
              <Input id="os-ed" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} /></div>
            <div className="space-y-2"><Label htmlFor="os-et">End time</Label>
              <Input id="os-et" type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} /></div>
            <div className="space-y-2"><Label>NAS</Label>
              <Select value={nasId} onValueChange={setNasId} disabled={nasLoading}>
                <SelectTrigger><SelectValue placeholder="All NAS devices" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All NAS devices</SelectItem>
                  {nasOptions?.map((n) => (
                    <SelectItem key={n.id} value={String(n.id)}>{n.name}{n.ipAddress ? ` (${n.ipAddress})` : ""}</SelectItem>
                  ))}
                </SelectContent>
              </Select></div>
            <Button type="submit" disabled={!startIso || !endIso || !!rangeError || find.isPending}>
              {find.isPending ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Search className="size-4 mr-2" />}
              Find Archives
            </Button>
            {rangeError && <p className="text-xs text-destructive col-span-full" role="alert">{rangeError}</p>}
          </form>
        </CardContent>
      </Card>

      {(find.isPending || find.isError || archives) && (
        <Card className="shadow-sm border-border">
          <CardHeader className="py-3 px-4 border-b border-border bg-muted/30 flex flex-row items-center justify-between gap-4 space-y-0 flex-wrap">
            <div>
              <CardTitle className="text-base">Matching Archives</CardTitle>
              <CardDescription className="text-xs tabular-nums">
                {chosen.length} of {archives?.length ?? 0} selected / est. {formatBytes(totalBytes)} decompressed
                / {nf.format(totalRecords)} archived records
              </CardDescription>
            </div>
            <Button size="sm" disabled={!chosen.length || tooLarge || prepare.isPending} onClick={() => setConfirmOpen(true)}>
              <Archive className="size-4 mr-2" /> Prepare Workspace
            </Button>
          </CardHeader>
          {tooLarge && (
            <div className="px-4 py-2 text-xs text-destructive border-b border-border" role="alert">
              Selection too large: {overArchives && `more than ${MAX_ARCHIVES} archives; `}
              {overBytes && `over ${formatBytes(MAX_ORIGINAL_BYTES)} decompressed; `}
              {overRecords && `over ${nf.format(MAX_RECORDS)} records; `}
              narrow the time range or deselect archives. Nothing is truncated automatically.
            </div>
          )}
          {prepare.isError && (
            <div className="px-4 py-2 text-xs text-destructive border-b border-border" role="alert">
              {apiErrorMessage(prepare.error, "Could not prepare workspace")}
            </div>
          )}
          <CardContent className="p-0 max-h-[420px] overflow-auto">
            {find.isPending ? (
              <div className="p-4 space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-5 w-full" />)}</div>
            ) : find.isError ? (
              <div className="p-6 text-sm text-destructive flex items-center justify-between gap-4">
                {apiErrorMessage(find.error, "Archive lookup failed")}
              </div>
            ) : !archives?.length ? (
              <div className="p-10 text-center text-sm text-muted-foreground">No archives cover this window. Try a wider range or another NAS.</div>
            ) : (
              <Table>
                <TableHeader className="sticky top-0 bg-background z-10">
                  <TableRow>
                    <TableHead className="w-10">
                      <Checkbox checked={allSelected} aria-label="Select all"
                        onCheckedChange={(v) => setSelected(v ? new Set(archives.map((a) => a.id)) : new Set())} />
                    </TableHead>
                    <TableHead className="text-xs font-mono">Window (IST)</TableHead>
                    <TableHead className="text-xs font-mono">NAS</TableHead>
                    <TableHead className="text-xs font-mono">File</TableHead>
                    <TableHead className="text-xs font-mono text-right">Records</TableHead>
                    <TableHead className="text-xs font-mono text-right">Decompressed</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {archives.map((a) => (
                    <TableRow key={a.id} className="text-xs font-mono cursor-pointer" data-state={selected.has(a.id) ? "selected" : undefined} onClick={() => toggle(a.id)}>
                      <TableCell onClick={(e) => e.stopPropagation()}>
                        <Checkbox checked={selected.has(a.id)} onCheckedChange={() => toggle(a.id)} aria-label={`Select ${a.fileName}`} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{fmtIst(a.periodStart)} <span className="text-muted-foreground">to</span> {fmtIst(a.periodEnd)}</TableCell>
                      <TableCell className="font-sans">{a.nasName ?? "Combined (legacy)"}</TableCell>
                      <TableCell className="text-muted-foreground truncate max-w-[220px]">{a.fileName}</TableCell>
                      <TableCell className="text-right tabular-nums">{nf.format(a.recordCount)}</TableCell>
                      <TableCell className="text-right tabular-nums">{formatBytes(a.originalBytes)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      <AlertDialog open={confirmOpen} onOpenChange={(o) => !prepare.isPending && setConfirmOpen(o)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2"><Lock className="size-4" /> Prepare temporary workspace?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>{chosen.length} archives, about {formatBytes(totalBytes)} decompressed and {nf.format(totalRecords)} records will be scanned.</p>
                <p>The selected archives are locked while your session is active, so they cannot be deleted mid-search. Original archives are never modified or deleted.</p>
                <p>The workspace holds a temporary copy, expires after 30 minutes of inactivity (status polling does not extend it), and is lost if the server restarts. Only one preparation can run at a time server-wide; you may hold one active session.</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={prepare.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction disabled={prepare.isPending} onClick={(e) => { e.preventDefault(); doPrepare(); }}>
              {prepare.isPending && <Loader2 className="size-4 mr-2 animate-spin" />} Lock and Prepare
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
