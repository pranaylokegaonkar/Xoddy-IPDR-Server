import { useEffect, useRef, useState } from "react";
import {
  getGetArchiveDeletionStatusQueryKey,
  useGetArchiveDeletionStatus,
  useStartArchiveDeletion,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface Props {
  selectedIds: number[];
  onStarted: () => void;
  onChanged: () => unknown;
  onBusyChange: (busy: boolean) => void;
}

function duration(seconds: number): string {
  const s = Math.max(0, Math.ceil(seconds));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h ${Math.floor(s % 3600 / 60)}m`;
}

export function ArchiveDeletionControls({ selectedIds, onStarted, onChanged, onBusyChange }: Props) {
  const client = useQueryClient();
  const { toast } = useToast();
  const start = useStartArchiveDeletion();
  const { data: status, isError, isLoading, refetch } = useGetArchiveDeletionStatus({
    query: {
      queryKey: getGetArchiveDeletionStatusQueryKey(),
      refetchInterval: (query) => query.state.data?.running ? 1000 : 5000,
    },
  });
  const observedJob = useRef<string | null>(null);
  const handledJob = useRef<string | null>(null);
  const [statusLost, setStatusLost] = useState(false);
  const busy = start.isPending || !!status?.running;

  useEffect(() => { onBusyChange(busy); }, [busy, onBusyChange]);
  useEffect(() => {
    if (!status || isError) return;
    if (status.running && status.jobId) {
      observedJob.current = status.jobId;
      setStatusLost(false);
    } else if (!status.jobId && observedJob.current) {
      // A process restart cannot be interpreted as a successful deletion.
      observedJob.current = null;
      setStatusLost(true);
      onChanged();
      toast({
        title: "Deletion status lost",
        description: "The server may have restarted. Some archives may already be deleted. Check the remaining list before trying again.",
        variant: "destructive",
      });
    } else if (status.jobId && observedJob.current === status.jobId && handledJob.current !== status.jobId) {
      handledJob.current = status.jobId;
      observedJob.current = null;
      onChanged();
      const hasErrors = status.failedCount > 0 || status.cleanupFailedCount > 0;
      toast({
        title: hasErrors ? "Deletion finished with errors" : "Deletion complete",
        description: `${status.deletedCount} archive entries removed; ${status.missingCount} already absent; ${status.failedCount} failed; ${status.cleanupFailedCount} share cleanup failures.`,
        ...(hasErrors ? { variant: "destructive" as const } : {}),
      });
    }
  }, [status, isError, onChanged, toast]);

  const handleStart = () => {
    if (!selectedIds.length || busy || isError || isLoading) return;
    if (!confirm(`Delete ${selectedIds.length} selected archive(s)?\n\nThis permanently removes the compressed files. This cannot be undone.`)) return;
    start.mutate({ data: { ids: [...selectedIds] } }, {
      onSuccess: (result) => {
        observedJob.current = result.status.jobId;
        setStatusLost(false);
        client.setQueryData(getGetArchiveDeletionStatusQueryKey(), result.status);
        onStarted();
        void refetch().then(() => onChanged());
      },
      onError: () => {
        // A lost response does not prove the server failed to start the job.
        void refetch().then(() => onChanged());
        toast({
          title: "Could not confirm deletion start",
          description: "Check the deletion status before trying again. A job may already be running.",
          variant: "destructive",
        });
      },
    });
  };

  const count = busy && status?.running ? status.totalCount : selectedIds.length;
  return (
    <div className="flex max-w-xs flex-col items-end gap-1">
      {(selectedIds.length > 0 || busy) && (
        <Button
          variant="destructive"
          onClick={handleStart}
          disabled={busy || isError || isLoading}
          data-testid="button-delete-selected-archives"
        >
          {busy ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Trash2 className="size-4 mr-2" />}
          Delete Selected ({count})
        </Button>
      )}
      <div className="text-right text-xs text-muted-foreground" aria-live="polite" role="status">
        {start.isPending && <p>Starting deletion…</p>}
        {status?.running && (
          <div data-testid="archive-deletion-progress">
            <p>Deleting: {status.processedCount}/{status.totalCount} processed ({status.progressPercent}%)</p>
            <div
              className="my-1 h-1 w-full overflow-hidden rounded bg-muted"
              role="progressbar"
              aria-label="Archive deletion"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={status.progressPercent}
            >
              <div className="h-full bg-destructive transition-all" style={{ width: `${status.progressPercent}%` }} />
            </div>
            <p>
              Estimated remaining: {status.etaSeconds === null ? "Calculating…" : `~${duration(status.etaSeconds)}`}
            </p>
            <p>Elapsed: {duration(status.elapsedSeconds)} · {status.deletedCount} deleted</p>
            {status.currentFileName && <p className="max-w-xs truncate" title={status.currentFileName}>{status.currentFileName}</p>}
          </div>
        )}
        {!status?.running && status?.jobId && (
          <p data-testid="archive-deletion-result">
            Finished: {status.deletedCount} deleted · {status.missingCount} already absent · {duration(status.elapsedSeconds)}
          </p>
        )}
        {!!status?.failedCount && <p className="text-destructive">{status.failedCount} failed to delete. Check Archive Logs.</p>}
        {!!status?.cleanupFailedCount && <p className="text-destructive">{status.cleanupFailedCount} Windows share files could not be removed. Check Archive Logs.</p>}
        {isError && <p className="text-destructive">Progress unavailable. Deletion may still be running; do not start it again.</p>}
        {statusLost && <p className="text-destructive">Status lost after a possible restart. Check remaining archives before retrying.</p>}
      </div>
    </div>
  );
}
