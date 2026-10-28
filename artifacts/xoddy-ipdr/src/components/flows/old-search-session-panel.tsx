import { useState } from "react";
import type { OldSearchSession } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Loader2, Lock, Trash2 } from "lucide-react";
import { fmtIst, formatBytes, nf } from "./old-search-utils";

interface Props {
  session: OldSearchSession;
  releasing: boolean;
  busy: boolean;
  onRelease: () => void;
}

export function OldSearchSessionPanel({ session: s, releasing, busy, onRelease }: Props) {
  const [open, setOpen] = useState(false);
  const preparing = s.state === "preparing";
  const pct = Math.max(0, Math.min(100, s.progressPercent));

  return (
    <Card className="shadow-sm border-border border-l-4 border-l-primary">
      <CardContent className="p-4 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-1">
            <div className="flex items-center gap-2">
              <Lock className="size-4 text-primary" />
              <span className="font-semibold">Temporary Workspace</span>
              <Badge variant={preparing ? "secondary" : "default"} className="uppercase text-[10px] tracking-wider">{s.state}</Badge>
            </div>
            <p className="text-xs text-muted-foreground">
              Flow end time {fmtIst(s.startAt)} to {fmtIst(s.endAt)} / {s.nasId ? `NAS #${s.nasId}` : "All NAS"}
            </p>
          </div>
          <Button variant="outline" size="sm" className="text-destructive" disabled={releasing || busy} onClick={() => setOpen(true)}
            title={busy ? "Wait for the current search or export to finish" : undefined}>
            {releasing ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Trash2 className="size-4 mr-2" />}
            {preparing ? "Cancel and Release" : "Release Temporary Workspace"}
          </Button>
        </div>

        {preparing && (
          <div className="space-y-1.5">
            <Progress value={pct} className="h-2" />
            <p className="text-xs text-muted-foreground tabular-nums">
              {pct.toFixed(1)}% / archive {s.processedArchives} of {s.totalArchives} / {nf.format(s.scannedRecords)} scanned
              / {nf.format(s.recordCount)} kept / {formatBytes(s.bytesWritten)} of ~{formatBytes(s.estimatedBytes)}
            </p>
          </div>
        )}

        <dl className="grid grid-cols-2 md:grid-cols-5 gap-3 text-xs">
          <Stat k="Archives" v={`${s.processedArchives}/${s.totalArchives}`} />
          <Stat k="Records in window" v={nf.format(s.recordCount)} />
          <Stat k="Workspace size" v={`${formatBytes(s.bytesWritten)} / ${formatBytes(s.maxWorkspaceBytes)}`} />
          <Stat k="Export limit" v={`${nf.format(s.exportLimit)} rows`} />
          <Stat k="Expires (if idle)" v={fmtIst(s.expiresAt)} />
        </dl>

        <p className="text-[11px] leading-relaxed text-muted-foreground border-t border-border pt-3">
          You are searching a temporary copy, not the original data. Selected archives stay locked against deletion
          while this session is active. The workspace expires after 30 minutes without searches or exports (status
          polling does not extend it) and is lost if the server restarts. Leaving this page does not release it.
        </p>
      </CardContent>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Release temporary workspace?</AlertDialogTitle>
            <AlertDialogDescription>
              {preparing ? "Preparation will be cancelled. " : ""}The temporary copy and current results are discarded and
              archive locks are lifted. Original archives are not deleted. You can prepare a new workspace afterwards.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep</AlertDialogCancel>
            <AlertDialogAction onClick={onRelease}>Release</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div className="rounded-md bg-muted/40 px-3 py-2">
      <dt className="text-muted-foreground">{k}</dt>
      <dd className="font-mono tabular-nums mt-0.5">{v}</dd>
    </div>
  );
}
