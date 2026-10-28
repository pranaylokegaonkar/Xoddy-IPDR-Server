import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { getGetArchiveUploadStatusQueryKey, useGetArchiveUploadStatus, type ArchiveUploadStatus } from "@workspace/api-client-react";
import { Upload, Loader2, CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { getToken } from "@/lib/token";

const STORAGE_KEY = "xoddy.archive-upload";
const LIMIT = 64 * 1024 * 1024;

function savedJob(): string | null {
  try { return sessionStorage.getItem(STORAGE_KEY); } catch { return null; }
}

function rememberJob(id: string | null): boolean {
  try {
    if (id) sessionStorage.setItem(STORAGE_KEY, id);
    else sessionStorage.removeItem(STORAGE_KEY);
    return true;
  } catch { return false; }
}

export function ArchiveUpload({ onUploaded }: { onUploaded: () => Promise<unknown> }) {
  const { toast } = useToast();
  const [jobId, setJobId] = useState<string | null>(savedJob);
  const [storageWarning, setStorageWarning] = useState(false);
  const [open, setOpen] = useState(!!jobId);
  const [file, setFile] = useState<File | null>(null);
  const [fileError, setFileError] = useState("");
  const handled = useRef<string | null>(null);
  const upload = useMutation({
    mutationFn: async (selected: File): Promise<ArchiveUploadStatus> => {
      // Send the File unchanged: Orval's fetch generator JSON-stringifies binary bodies.
      const response = await fetch(`${import.meta.env.BASE_URL}api/archives/upload?fileName=${encodeURIComponent(selected.name)}`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/gzip", Authorization: `Bearer ${getToken() ?? ""}` },
        body: selected,
      });
      if (!response.ok) {
        if (response.status === 413) throw new Error("File too large. The app limit is 64 MiB; your Ubuntu proxy may need client_max_body_size 64m.");
        const error = await response.json().catch(() => null);
        throw new Error(error?.error ?? `Upload failed (HTTP ${response.status}). Check the archive list before retrying.`);
      }
      return response.json();
    },
    onSuccess: (status) => {
      setJobId(status.id);
      if (!rememberJob(status.id)) setStorageWarning(true);
    },
  });
  const { data, isError: statusError, isFetchedAfterMount } = useGetArchiveUploadStatus(jobId ?? "", {
    query: {
      queryKey: getGetArchiveUploadStatusQueryKey(jobId ?? ""),
      enabled: !!jobId,
      gcTime: 0,
      retry: 1,
      refetchInterval: (query) => query.state.status === "error" ? false :
        !query.state.data || query.state.data.state === "validating" ? 1000 : false,
    },
  });
  // Do not show another login's cached job until ownership is rechecked.
  const status = !statusError && isFetchedAfterMount ? data :
    upload.data?.id === jobId ? upload.data : undefined;
  const busy = upload.isPending || (!!jobId && !status && !statusError) || (!statusError && status?.state === "validating");

  useEffect(() => {
    if (!status || status.state === "validating" || handled.current === status.id) return;
    handled.current = status.id;
    if (!rememberJob(null)) setStorageWarning(true);
    if (status.state === "complete") {
      void onUploaded();
      toast({ title: "Archive uploaded", description: `${status.recordCount.toLocaleString()} flow records saved in Data Archives. Live flows were not changed.` });
    }
  }, [status, onUploaded, toast]);

  const chooseFile = (selected: File | undefined) => {
    setFile(null);
    if (!selected) { setFileError(""); return; }
    if (!/\.json\.gz$/i.test(selected.name)) { setFileError("Only .json.gz files are accepted."); return; }
    if (!selected.size || selected.size > LIMIT) { setFileError("Choose a non-empty file no larger than 64 MiB."); return; }
    setFileError("");
    setFile(selected);
  };

  return (
    <>
      <Button variant="outline" onClick={() => setOpen(true)}>
        <Upload className="size-4 mr-2" /> Upload Archive
      </Button>
      <Dialog open={open} onOpenChange={(value) => { if (!busy) setOpen(value); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Upload Data Archive</DialogTitle>
            <DialogDescription>
              Upload a .json.gz archive downloaded from Xoddy IPDR. It will use the same storage as automatic archives.
              This does not restore live flows or overwrite existing archives.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="archive-upload-file">Archive file (.json.gz only)</Label>
              <Input id="archive-upload-file" type="file" accept=".json.gz,.JSON.GZ" disabled={busy}
                onChange={(event) => chooseFile(event.target.files?.[0])} />
              <p className="text-xs text-muted-foreground">
                Limits: 64 MiB compressed, 512 MiB expanded, 1,000,000 records. NAS IDs are retained; use a backup from this server.
              </p>
              {fileError && <p role="alert" className="text-sm text-destructive">{fileError}</p>}
            </div>
            <div role="status" aria-live="polite" className="space-y-2 text-sm">
              {storageWarning && <p className="text-xs text-muted-foreground">This browser cannot remember upload progress. Keep this page open until completion.</p>}
              {upload.isPending && <p className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> Uploading file…</p>}
              {!upload.isPending && status?.state === "validating" && !statusError && (
                <p className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" />
                  Validating and saving {status.fileName}… {status.recordCount.toLocaleString()} records checked.
                </p>
              )}
              {status?.state === "complete" && (
                <div className="rounded-md border p-3 space-y-2">
                  <p className="flex items-center gap-2 font-medium"><CheckCircle2 className="size-4" /> Archive saved: {status.fileName}</p>
                  <p>{status.recordCount.toLocaleString()} records. Open Old Search to search or export the uploaded archive.</p>
                  <p className="text-xs text-muted-foreground">If it is outside your current date/NAS filters, adjust them and click Show Data.</p>
                </div>
              )}
            </div>
            {(upload.isError || status?.state === "error" || statusError) && (
              <p role="alert" className="text-sm text-destructive">
                {statusError ? "Upload status is unavailable. Check Data Archives before uploading again; a missing status does not prove the file was not saved."
                  : status?.error ?? upload.error?.message}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={() => setOpen(false)}>Close</Button>
            <Button disabled={!file || !!fileError || busy} onClick={() => {
              setJobId(null); handled.current = null;
              if (!rememberJob(null)) setStorageWarning(true);
              upload.mutate(file!);
            }}>
              {busy ? <Loader2 className="size-4 mr-2 animate-spin" /> : <Upload className="size-4 mr-2" />} Upload Archive
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
