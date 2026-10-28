import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListOldSearchSessions, getListOldSearchSessionsQueryKey,
  useGetOldSearchSession, getGetOldSearchSessionQueryKey,
  useReleaseOldSearchSession, type OldSearchSession,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { AlertTriangle, X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { OldSearchArchivePicker } from "./old-search-archive-picker";
import { OldSearchSessionPanel } from "./old-search-session-panel";
import { OldSearchWorkspace } from "./old-search-workspace";
import { apiErrorMessage, errorStatus, isActive, LAST_SESSION_KEY } from "./old-search-utils";

export function OldSearch() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [sessionId, setSessionId] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const resolved = useRef(false);

  const list = useListOldSearchSessions({ query: { queryKey: getListOldSearchSessionsQueryKey(), staleTime: 0 } });
  const sessionQ = useGetOldSearchSession(sessionId, {
    query: { queryKey: getGetOldSearchSessionQueryKey(sessionId), enabled: !!sessionId, refetchInterval: 2000 },
  });
  const release = useReleaseOldSearchSession();

  // Resume own active session once on mount; explain if a remembered one vanished.
  useEffect(() => {
    if (resolved.current || !list.data || list.isFetching || list.isError) return;
    resolved.current = true;
    const active = list.data.find((s) => isActive(s));
    const last = localStorage.getItem(LAST_SESSION_KEY);
    if (active) {
      setSessionId(active.id);
      localStorage.setItem(LAST_SESSION_KEY, active.id);
    } else if (last) {
      const prev = list.data.find((s) => s.id === last);
      setNotice(prev ? endedMessage(prev) : "Your previous temporary workspace no longer exists. It may have expired, been released, or been cleared by a server restart. Original archives are unaffected; prepare a new workspace to continue.");
      localStorage.removeItem(LAST_SESSION_KEY);
    }
  }, [list.data, list.isFetching, list.isError]);

  const session = sessionQ.data;
  const missing = !!sessionId && sessionQ.isError && errorStatus(sessionQ.error) === 404;

  // Clear stale workspace when it ends.
  useEffect(() => {
    if (!sessionId) return;
    if (missing) { clear("The temporary workspace was not found on the server (expired, released, or cleared by a restart). Prepare a new one to continue."); return; }
    if (session && session.id === sessionId && !isActive(session)) clear(endedMessage(session));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, missing, sessionId]);

  function clear(msg: string | null) {
    if (sessionId) qc.removeQueries({ queryKey: getGetOldSearchSessionQueryKey(sessionId) });
    setSessionId("");
    setBusy(false);
    setNotice(msg);
    localStorage.removeItem(LAST_SESSION_KEY);
    void qc.invalidateQueries({ queryKey: getListOldSearchSessionsQueryKey() });
  }

  const onPrepared = (s: OldSearchSession) => {
    qc.setQueryData(getGetOldSearchSessionQueryKey(s.id), s);
    localStorage.setItem(LAST_SESSION_KEY, s.id);
    setNotice(null);
    setSessionId(s.id);
  };

  const doRelease = () => {
    release.mutate({ id: sessionId }, {
      onSuccess: () => { clear(null); toast({ title: "Workspace released", description: "Temporary data discarded. Original archives untouched." }); },
      onError: (err) => toast({ title: "Release failed", description: apiErrorMessage(err, "Release failed"), variant: "destructive" }),
    });
  };

  return (
    <div className="space-y-6">
      {notice && (
        <div role="status" className="flex items-start gap-3 rounded-md border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm">
          <AlertTriangle className="size-4 mt-0.5 text-amber-600 shrink-0" />
          <p className="flex-1">{notice}</p>
          <button aria-label="Dismiss" onClick={() => setNotice(null)} className="text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
        </div>
      )}

      {list.isLoading || (sessionId && !session && !sessionQ.isError) ? (
        <Card><CardContent className="p-4 space-y-3"><Skeleton className="h-5 w-1/3" /><Skeleton className="h-2 w-full" /><Skeleton className="h-16 w-full" /></CardContent></Card>
      ) : list.isError && !sessionId ? (
        <Card><CardContent className="p-6 flex items-center justify-between gap-4 text-sm">
          <span className="text-destructive">{apiErrorMessage(list.error, "Could not check existing sessions")}</span>
          <Button size="sm" variant="outline" onClick={() => void list.refetch()}>Retry</Button>
        </CardContent></Card>
      ) : sessionId && session && isActive(session) ? (
        <>
          {sessionQ.isError && (
            <p className="text-xs text-destructive" role="alert">Status refresh failed: {apiErrorMessage(sessionQ.error, "Status unavailable")}. Retrying.</p>
          )}
          <OldSearchSessionPanel session={session} releasing={release.isPending} busy={busy} onRelease={doRelease} />
          {session.state === "ready" && (
            <OldSearchWorkspace key={session.id} session={session} onBusyChange={setBusy}
              onReleasedByExport={() => { void sessionQ.refetch(); }} />
          )}
        </>
      ) : (
        <OldSearchArchivePicker onPrepared={onPrepared} />
      )}
    </div>
  );
}

function endedMessage(s: OldSearchSession): string {
  switch (s.state) {
    case "expired": return "Your temporary workspace expired after 30 minutes of inactivity. Prepare a new one to continue.";
    case "released": return "Your temporary workspace was released. Prepare a new one to search again.";
    case "error": return `Workspace preparation failed: ${s.error ?? "unknown error"}. If the selection was too large, narrow the range or select fewer archives.`;
    default: return "Your temporary workspace is no longer available.";
  }
}
