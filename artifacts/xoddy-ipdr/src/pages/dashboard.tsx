import React, { useState, useEffect, useRef } from "react";
import { useGetDashboardSummary, getGetDashboardSummaryQueryKey, useGetFlowTrend, getGetFlowTrendQueryKey, useGetTopTalkers, getGetTopTalkersQueryKey, useDeleteAllFlows, useGetAllFlowDeletionStatus, getGetAllFlowDeletionStatusQueryKey, useGetSystemResources, getGetSystemResourcesQueryKey } from "@workspace/api-client-react";
import appPackage from "../../package.json";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Server, Activity, ArrowUpRight, ArrowDownRight, Clock, ShieldCheck, Database, Bell, Trash2, Loader2, HardDrive, MemoryStick } from "lucide-react";
import { format, parseISO } from "date-fns";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";

export default function Dashboard() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: summary, isLoading: isLoadingSummary } = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey() } });
  const { data: trend, isLoading: isLoadingTrend } = useGetFlowTrend({ query: { queryKey: getGetFlowTrendQueryKey() } });
  const { data: topTalkers, isLoading: isLoadingTalkers } = useGetTopTalkers({ query: { queryKey: getGetTopTalkersQueryKey() } });
  const { data: resources, isLoading: isLoadingResources } = useGetSystemResources({ query: { queryKey: getGetSystemResourcesQueryKey(), refetchInterval: 10000 } });

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
          <div className="flex items-center gap-4">
            <div
              className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-md border border-border"
              title="Application version"
            >
              <span className="text-xs font-medium font-mono text-muted-foreground">Version v{appPackage.version}</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-md border border-border">
              <div className="size-2 rounded-full bg-green-500 animate-pulse"></div>
              <span className="text-xs font-medium font-mono text-muted-foreground">UDP:{summary.collectorPort}</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1.5 bg-primary/10 text-primary rounded-md border border-primary/20">
              <ShieldCheck className="size-4" />
              <span className="text-xs font-semibold uppercase tracking-wider">DOT IPDR Compliant</span>
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
            title="Data Volume (24h)" 
            value={isLoadingSummary ? null : formatBytes(summary?.totalBytes || 0)} 
            icon={Database} 
            description="Stored in TSDB"
            action={
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-xs text-destructive hover:text-destructive hover:bg-destructive/10"
                onClick={() => setConfirmOpen(true)}
                disabled={purging || deleteAllFlows.isPending}
                title="Delete all stored flow data (archives kept)"
              >
                {purging ? <Loader2 className="size-3.5 mr-1 animate-spin" /> : <Trash2 className="size-3.5 mr-1" />}
                Delete all stored data
              </Button>
            }
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

        {/* Charts row */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Card className="lg:col-span-2 flex flex-col shadow-sm border-border overflow-hidden">
            <CardHeader className="pb-2 border-b border-border/50 bg-muted/20">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-semibold">Flow Volume Trend (24h)</CardTitle>
                {summary?.lastFlowAt && (
                  <div className="flex items-center text-xs text-muted-foreground gap-1.5">
                    <Clock className="size-3" />
                    Last flow: {format(parseISO(summary.lastFlowAt), "HH:mm:ss")}
                  </div>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-6 flex-1 min-h-[300px]">
              {isLoadingTrend ? (
                <div className="w-full h-full flex items-center justify-center">
                  <Skeleton className="w-full h-full rounded-md" />
                </div>
              ) : trend && trend.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trend} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
                    <XAxis 
                      dataKey="time" 
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                      tickMargin={10}
                    />
                    <YAxis 
                      axisLine={false}
                      tickLine={false}
                      tick={{ fontSize: 12, fill: 'hsl(var(--muted-foreground))' }}
                      tickFormatter={(val) => formatNumber(val)}
                    />
                    <RechartsTooltip 
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px', fontSize: '12px' }}
                      formatter={(value: number) => [formatNumber(value), 'Flows']}
                    />
                    <Area type="monotone" dataKey="count" stroke="hsl(var(--primary))" strokeWidth={2} fillOpacity={1} fill="url(#colorCount)" />
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <div className="w-full h-full flex flex-col items-center justify-center text-muted-foreground">
                  <Activity className="size-8 mb-2 opacity-20" />
                  <p className="text-sm">No flow data in the last 24 hours.</p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="shadow-sm border-border">
            <CardHeader className="pb-2 border-b border-border/50 bg-muted/20">
              <CardTitle className="text-base font-semibold">Top Talkers (Source IP)</CardTitle>
              <CardDescription>Highest bandwidth consumers (last 24h)</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              {isLoadingTalkers ? (
                <div className="p-4 space-y-4">
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                  <Skeleton className="h-10 w-full" />
                </div>
              ) : topTalkers && topTalkers.length > 0 ? (
                <div className="divide-y divide-border">
                  {topTalkers.map((talker, i) => (
                    <div key={talker.ip} className="flex items-center justify-between p-4 hover:bg-muted/50 transition-colors">
                      <div className="flex items-center gap-3">
                         <div className="flex items-center justify-center size-6 rounded bg-primary/10 text-primary text-xs font-bold">
                          {i + 1}
                        </div>
                        <div>
                          <p className="text-sm font-medium font-mono leading-none">{talker.ip}</p>
                          <p className="text-xs text-muted-foreground mt-1">{formatNumber(talker.count)} flows</p>
                        </div>
                      </div>
                      <div className="text-right">
                        <Badge variant="secondary" className="font-mono text-xs">
                          {formatBytes(talker.bytes)}
                        </Badge>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="p-8 text-center text-muted-foreground text-sm">
                  No talker data available.
                </div>
              )}
            </CardContent>
          </Card>
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
