import React from "react";
import { useGetDashboardSummary, getGetDashboardSummaryQueryKey, useGetFlowTrend, getGetFlowTrendQueryKey, useGetTopTalkers, getGetTopTalkersQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Server, Activity, ArrowUpRight, ArrowDownRight, Clock, ShieldCheck, Database, Bell } from "lucide-react";
import { format, parseISO } from "date-fns";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, AreaChart, Area } from 'recharts';
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";

export default function Dashboard() {
  const { data: summary, isLoading: isLoadingSummary } = useGetDashboardSummary({ query: { queryKey: getGetDashboardSummaryQueryKey() } });
  const { data: trend, isLoading: isLoadingTrend } = useGetFlowTrend({ query: { queryKey: getGetFlowTrendQueryKey() } });
  const { data: topTalkers, isLoading: isLoadingTalkers } = useGetTopTalkers({ query: { queryKey: getGetTopTalkersQueryKey() } });

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
          />
          <MetricCard 
            title="Unread Alerts" 
            value={isLoadingSummary ? null : summary?.unreadNotifications} 
            icon={Bell} 
            description="Require attention"
            alert={!isLoadingSummary && (summary?.unreadNotifications || 0) > 0}
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
    </div>
  );
}

function MetricCard({ title, value, icon: Icon, description, trend, trendUp, alert }: any) {
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
        </div>
      </CardContent>
    </Card>
  );
}
