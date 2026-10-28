import React, { useState, useEffect, useRef } from "react";
import { useGetDashboardSummary, getGetDashboardSummaryQueryKey, useDeleteAllFlows, useGetAllFlowDeletionStatus, getGetAllFlowDeletionStatusQueryKey, useGetSystemResources, getGetSystemResourcesQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Server, Activity, ArrowUpRight, ArrowDownRight, ShieldCheck, Cpu, Bell, Trash2, Loader2, HardDrive, MemoryStick } from "lucide-react";
import { format } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

export default function Dashboard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [currentDateTime, setCurrentDateTime] = useState(() => new Date());
  const { data: summary, isLoading: isLoadingSummary } = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey() } });
  const { data: resources, isLoading: isLoadingResources, isError: isResourcesError } = useGetSystemResources({ query: { queryKey: getGetSystemResourcesQueryKey(), refetchInterval: 10000 } });
  const cpu = isResourcesError ? null : resources?.cpu;

  useEffect(() => {
    const timer = window.setInterval(() => setCurrentDateTime(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const deleteAllFlows = useDeleteAllFlows();
  const [confirmOpen, setConfirmOpen] = useState(false);
  // Poll the global purge status while a run is active (or just finished, so the
  // banner can linger at 100% briefly before clearing).
  const [purging, setPurging] = useState(false);
  const wasPurging = useRef(false);
  const { data: purgeStatus } = useGetAllFlowDeletionStatus({
    query: {
      queryKey: getGetAllFlowDeletionStatusQueryKey(),
      enabled: purging,
      refetchInterval: purging ? 1000 : false,
    },
  });

  useEffect(() => {
    if (!purgeStatus) return undefined;
    if (purgeStatus.running) {
      wasPurging.current = true;
      return undefined;
    }
    // Transitioned from running -> done: refresh dashboard figures, toast, clear.
    if (wasPurging.current) {
      wasPurging.current = false;
      queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      if (purgeStatus.lastError) {
        toast({ title: "Purge failed", description: purgeStatus.lastError, variant: "destructive" });
      } else {
        toast({ title: "Stored data deleted", description: `${purgeStatus.deletedCount.toLocaleString()} record(s) removed. Archives kept.` });
      }
      const t = setTimeout(() => setPurging(false), 2500);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [purgeStatus, queryClient, toast]);

  const confirmPurge = () => {
    deleteAllFlows.mutate(undefined, {
      onSuccess: (res) => {
        setConfirmOpen(false);
        if (!res.started) {
          toast({ title: "Already running", description: "A deletion is already in progress." });
        }
        queryClient.removeQueries({ queryKey: getGetAllFlowDeletionStatusQueryKey() });
        wasPurging.current = true;
        setPurging(true);
      },
      onError: (err: any) => {
        toast({ title: "Error", description: err.message, variant: "destructive" });
      },
    });
  };

  const formatBytes = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-US', { notation: "compact", compactDisplay: "short" }).format(num);
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-auto">
      <div className="flex items-center justify-between px-8 pt-8 pb-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight font-sans">Dashboard</h1>
          <p className="text-muted-foreground text-sm mt-1">Operational overview and traffic analysis.</p>
        </div>
        
        {summary && (
          <div className="flex items-start gap-4">
            <div className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-md border border-border">
              <div className="size-2 rounded-full bg-green-500 animate-pulse"></div>
              <span className="text-xs font-medium font-mono text-muted-foreground">UDP:{summary.collectorPort}</span>
            </div>
            <div className="flex flex-col items-end gap-1">
              <div className="flex items-center gap-2 px-3 py-1.5 bg-primary/10 text-primary rounded-md border border-primary/20">
                <ShieldCheck className="size-4" />
                <span className="text-xs font-semibold uppercase tracking-wider">DOT IPDR Compliant</span>
              </div>
              <time
                className="font-mono text-muted-foreground whitespace-nowrap text-[16px]"
                dateTime={currentDateTime.toISOString()}
                title="Local date and time"
              >
                {format(currentDateTime, "dd MMM yyyy, HH:mm:ss")}
              </time>
            </div>
          </div>
        )}
      </div>
      <div className="p-8 pt-4 space-y-6">
        {purging && purgeStatus && (
          <Card className="border-destructive/40 bg-destructive/5 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                  <Loader2 className="size-4 text-destructive animate-spin shrink-0" />
                  <span className="text-sm font-medium">
                    {purgeStatus.running ? "Deleting all stored data" : "Deletion complete"}
                  </span>
                  <span className="text-xs text-muted-foreground truncate">archives are kept</span>
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground font-mono shrink-0">
                  <span>{purgeStatus.deletedCount.toLocaleString()} / {purgeStatus.totalCount.toLocaleString()}</span>
                  {purgeStatus.elapsedSeconds != null && <span>{purgeStatus.elapsedSeconds}s elapsed</span>}
                  {purgeStatus.running && purgeStatus.etaSeconds != null && <span>~{purgeStatus.etaSeconds}s left</span>}
                  <span className="font-semibold text-foreground">{(purgeStatus.progressPercent ?? 0).toFixed(0)}%</span>
                </div>
              </div>
              <div className="mt-3 h-1.5 w-full rounded-full bg-muted overflow-hidden">
                <div className="h-full bg-destructive transition-all duration-500" style={{ width: `${purgeStatus.progressPercent ?? 0}%` }} />
              </div>
            </CardContent>
          </Card>
        )}

        {/* Top metrics row */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <MetricCard 
            title="Total Flows (24h)" 
            value={isLoadingSummary ? null : formatNumber(summary?.flowsToday || 0)} 
            icon={Activity} 
            description={isLoadingSummary ? null : `${formatNumber(summary?.totalFlows || 0)} total retained`}
            trend="+12%"
            trendUp={true}
          />
          <MetricCard 
            title="Active NAS Devices" 
            value={isLoadingSummary ? null : summary?.activeNas} 
            icon={Server} 
            description={isLoadingSummary ? null : `${summary?.inactiveNas} inactive / ${summary?.totalNas} total`}
          />
          <MetricCard 
            title="CPU Utilization"
            value={isLoadingResources ? null : cpu ? `${cpu.percent.toFixed(1)}%` : "Unavailable"}
            icon={Cpu}
            description={cpu ? (
              <>
                <span className="block">Server total · {cpu.logicalCpus} logical CPUs</span>
                <span className="block mt-1" title="App usage includes all process threads and may exceed 100% when using multiple cores.">
                  App: {cpu.processPercent.toFixed(1)}% · 100% = 1 core
                </span>
              </>
            ) : isLoadingResources ? "Reading CPU usage…" : "CPU reading unavailable"}
          />
          <MetricCard 
            title="Unread Alerts" 
            value={isLoadingSummary ? null : summary?.unreadNotifications} 
            icon={Bell} 
            description="Require attention"
            alert={!isLoadingSummary && (summary?.unreadNotifications || 0) > 0}
          />
        </div>

        {/* Server resources row */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <ResourceCard
            title="Disk Space"
            icon={HardDrive}
            data={resources?.disk}
            loading={isLoadingResources}
            formatBytes={formatBytes}
          />
          <ResourceCard
            title="Memory (RAM)"
            icon={MemoryStick}
            data={resources?.memory}
            loading={isLoadingResources}
            formatBytes={formatBytes}
          />
        </div>

      </div>
      <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete all stored data?</DialogTitle>
            <DialogDescription>
              This removes every already-compressed flow record from the live database, for <span className="font-medium text-foreground">all NAS devices</span>, freeing the stored data volume. The downloadable archive files on the Archives page are kept, so no IPDR data is lost. Records not yet compressed are left untouched. This runs in the background and cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmOpen(false)}>Cancel</Button>
            <Button variant="destructive" onClick={confirmPurge} disabled={deleteAllFlows.isPending}>
              {deleteAllFlows.isPending ? <Loader2 className="size-4 mr-1 animate-spin" /> : <Trash2 className="size-4 mr-1" />}
              Delete all stored data
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ResourceCard({ title, icon: Icon, data, loading, formatBytes }: any) {
  const percent = data ? Math.min(100, Math.max(0, data.percent)) : 0;
  const high = percent >= 90;
  const mid = percent >= 75 && percent < 90;
  const barColor = high ? "bg-destructive" : mid ? "bg-amber-500" : "bg-primary";
  const pctColor = high ? "text-destructive" : mid ? "text-amber-600" : "text-foreground";

  return (
    <Card className="shadow-sm border-border">
      <CardContent className="p-6">
        <div className="flex items-center justify-between pb-3">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <div className="p-2 rounded-md bg-primary/10 text-primary">
            <Icon className="h-4 w-4" />
          </div>
        </div>

        {loading || !data ? (
          <div className="space-y-3">
            <Skeleton className="h-8 w-32" />
            <Skeleton className="h-2 w-full" />
          </div>
        ) : (
          <>
            <div className="flex items-baseline gap-2">
              <span className="text-3xl font-bold tracking-tight">{formatBytes(data.used)}</span>
              <span className="text-sm text-muted-foreground">used of {formatBytes(data.total)}</span>
            </div>

            <div className="mt-3 h-2 w-full rounded-full bg-muted overflow-hidden">
              <div className={`h-full ${barColor} transition-all duration-500`} style={{ width: `${percent}%` }} />
            </div>

            <div className="mt-2 flex items-center justify-between text-xs">
              <span className="text-muted-foreground">{formatBytes(data.free)} free</span>
              <span className={`font-semibold ${pctColor}`}>{percent.toFixed(1)}% used</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}

function MetricCard({ title, value, icon: Icon, description, trend, trendUp, alert, action }: any) {
  return (
    <Card className={`shadow-sm border-border ${alert ? 'border-destructive/50 shadow-[0_0_0_1px_rgba(239,68,68,0.2)]' : ''}`}>
      <CardContent className="p-6">
        <div className="flex items-center justify-between space-y-0 pb-2">
          <p className="text-sm font-medium text-muted-foreground">{title}</p>
          <div className={`p-2 rounded-md ${alert ? 'bg-destructive/10 text-destructive' : 'bg-primary/10 text-primary'}`}>
            <Icon className="h-4 w-4" />
          </div>
        </div>
        <div className="flex flex-col gap-1">
          {value === null ? (
            <Skeleton className="h-8 w-24 mt-1" />
          ) : (
            <div className="text-3xl font-bold tracking-tight">{value}</div>
          )}
          
          <div className="flex items-center text-xs mt-1">
            {trend && (
              <span className={`flex items-center font-medium mr-2 ${trendUp ? 'text-green-600' : 'text-red-600'}`}>
                {trendUp ? <ArrowUpRight className="size-3 mr-0.5" /> : <ArrowDownRight className="size-3 mr-0.5" />}
                {trend}
              </span>
            )}
            {description && (
              <span className="text-muted-foreground truncate">{description}</span>
            )}
          </div>

          {action && <div className="mt-3 -ml-2">{action}</div>}
        </div>
      </CardContent>
    </Card>
  );
}
