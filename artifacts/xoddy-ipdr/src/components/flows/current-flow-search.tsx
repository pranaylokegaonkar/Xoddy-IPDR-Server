import React, { useState } from "react";
import { useSearchFlows, useGetNasList, getGetNasListQueryKey } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Download, Search, FileText, FileSpreadsheet } from "lucide-react";
import { format } from "date-fns";
import { useToast } from "@/hooks/use-toast";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";

export function CurrentFlowSearch() {
  const { toast } = useToast();
  const searchFlows = useSearchFlows();
  const { data: nasList } = useGetNasList({ query: { queryKey: getGetNasListQueryKey() } });

  const [filters, setFilters] = useState({
    srcIp: "",
    dstIp: "",
    srcNatIp: "",
    dstNatIp: "",
    nasId: "all",
    dateFrom: "",
    dateTo: "",
    startTime: "",
    endTime: ""
  });

  const [page, setPage] = useState(1);
  const pageSize = 50;

  const handleSearch = (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setPage(1);
    executeSearch(1);
  };

  const executeSearch = (pageNum: number) => {
    const payload: any = { page: pageNum, pageSize };
    if (filters.srcIp) payload.srcIp = filters.srcIp;
    if (filters.dstIp) payload.dstIp = filters.dstIp;
    if (filters.srcNatIp) payload.srcNatIp = filters.srcNatIp;
    if (filters.dstNatIp) payload.dstNatIp = filters.dstNatIp;
    if (filters.nasId && filters.nasId !== "all") payload.nasId = parseInt(filters.nasId);
    if (filters.dateFrom) payload.dateFrom = filters.dateFrom;
    if (filters.dateTo) payload.dateTo = filters.dateTo;
    if (filters.startTime) payload.startTime = filters.startTime;
    if (filters.endTime) payload.endTime = filters.endTime;

    searchFlows.mutate({ data: payload });
  };

  const handleExport = async (format: "text" | "excel") => {
    try {
      const payload: any = { format };
      if (filters.srcIp) payload.srcIp = filters.srcIp;
      if (filters.dstIp) payload.dstIp = filters.dstIp;
      if (filters.srcNatIp) payload.srcNatIp = filters.srcNatIp;
      if (filters.dstNatIp) payload.dstNatIp = filters.dstNatIp;
      if (filters.nasId && filters.nasId !== "all") payload.nasId = parseInt(filters.nasId);
      if (filters.dateFrom) payload.dateFrom = filters.dateFrom;
      if (filters.dateTo) payload.dateTo = filters.dateTo;
      if (filters.startTime) payload.startTime = filters.startTime;
      if (filters.endTime) payload.endTime = filters.endTime;

      const response = await fetch(`${import.meta.env.BASE_URL}api/flows/export`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });

      if (!response.ok) throw new Error("Export failed");

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = format === "text" ? "ipdr-export.txt" : "ipdr-export.xlsx";
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
      
      toast({ title: "Export Started", description: "Your file is downloading." });
    } catch (err: any) {
      toast({ title: "Export Error", description: err.message, variant: "destructive" });
    }
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    executeSearch(newPage);
  };

  const data = searchFlows.data;

  return (
    <>
      <div className="space-y-6">
        <Card className="shadow-sm border-border">
          <CardHeader className="pb-4">
            <CardTitle className="text-lg">Filter Criteria</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSearch} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-5 gap-4">
                <div className="space-y-2">
                  <Label>Source IP</Label>
                  <Input value={filters.srcIp} onChange={e => setFilters({...filters, srcIp: e.target.value})} placeholder="e.g. 192.168.1.1" />
                </div>
                <div className="space-y-2">
                  <Label>Destination IP</Label>
                  <Input value={filters.dstIp} onChange={e => setFilters({...filters, dstIp: e.target.value})} placeholder="e.g. 8.8.8.8" />
                </div>
                <div className="space-y-2">
                  <Label>Source NAT IP</Label>
                  <Input value={filters.srcNatIp} onChange={e => setFilters({...filters, srcNatIp: e.target.value})} placeholder="Translated Source" />
                </div>
                <div className="space-y-2">
                  <Label>Destination NAT IP</Label>
                  <Input value={filters.dstNatIp} onChange={e => setFilters({...filters, dstNatIp: e.target.value})} placeholder="Translated Dest" />
                </div>
                <div className="space-y-2">
                  <Label>NAS Device</Label>
                  <Select value={filters.nasId} onValueChange={(val) => setFilters({...filters, nasId: val})}>
                    <SelectTrigger><SelectValue placeholder="All Devices" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Devices</SelectItem>
                      {nasList?.map((nas) => (
                        <SelectItem key={nas.id} value={nas.id.toString()}>{nas.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                
                <div className="space-y-2">
                  <Label>Date From</Label>
                  <Input type="date" value={filters.dateFrom} onChange={e => setFilters({...filters, dateFrom: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <Label>Date To</Label>
                  <Input type="date" value={filters.dateTo} onChange={e => setFilters({...filters, dateTo: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <Label>Time From</Label>
                  <Input type="time" value={filters.startTime} onChange={e => setFilters({...filters, startTime: e.target.value})} />
                </div>
                <div className="space-y-2">
                  <Label>Time To</Label>
                  <Input type="time" value={filters.endTime} onChange={e => setFilters({...filters, endTime: e.target.value})} />
                </div>
                
                <div className="flex items-end space-x-2">
                  <Button type="submit" className="w-full flex items-center gap-2" disabled={searchFlows.isPending}>
                    <Search className="size-4" /> Search
                  </Button>
                </div>
              </div>
            </form>
          </CardContent>
        </Card>

        <Card className="flex flex-col shadow-sm border-border flex-1 min-h-[400px]">
          <CardHeader className="py-3 px-4 border-b border-border bg-muted/30 flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="text-base font-semibold">Results</CardTitle>
              {data && (
                <CardDescription className="text-xs">
                  Found {data.total} records (showing page {data.page} of {Math.ceil(data.total / data.pageSize)})
                </CardDescription>
              )}
            </div>
            
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" className="h-8 text-xs font-medium" onClick={() => handleExport("text")} disabled={!data || data.total === 0}>
                <FileText className="size-3 mr-1" /> Text Export
              </Button>
              <Button size="sm" variant="outline" className="h-8 text-xs font-medium" onClick={() => handleExport("excel")} disabled={!data || data.total === 0}>
                <FileSpreadsheet className="size-3 mr-1" /> Excel Export
              </Button>
            </div>
          </CardHeader>
          <CardContent className="p-0 flex-1 overflow-auto">
            <Table>
              <TableHeader className="sticky top-0 bg-background z-10 shadow-[0_1px_0_0_hsl(var(--border))]">
                <TableRow>
                  <TableHead className="whitespace-nowrap font-mono text-xs">Time</TableHead>
                  <TableHead className="whitespace-nowrap font-mono text-xs">NAS</TableHead>
                  <TableHead className="whitespace-nowrap font-mono text-xs">Src IP:Port</TableHead>
                  <TableHead className="whitespace-nowrap font-mono text-xs">Dst IP:Port</TableHead>
                  <TableHead className="whitespace-nowrap font-mono text-xs">Src NAT IP</TableHead>
                  <TableHead className="whitespace-nowrap font-mono text-xs">Dst NAT IP</TableHead>
                  <TableHead className="whitespace-nowrap font-mono text-xs">Proto</TableHead>
                  <TableHead className="whitespace-nowrap font-mono text-xs text-right">Bytes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {searchFlows.isPending ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <TableRow key={i}>
                      <TableCell colSpan={8} className="py-3">
                        <Skeleton className="h-4 w-full" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : data && data.records.length > 0 ? (
                  data.records.map((row) => (
                    <TableRow key={row.id} className="text-xs font-mono">
                      <TableCell className="whitespace-nowrap">{format(new Date(row.startTime), "yyyy-MM-dd HH:mm:ss")}</TableCell>
                      <TableCell className="font-sans font-medium">{row.nasName}</TableCell>
                      <TableCell>{row.srcIp}:{row.srcPort}</TableCell>
                      <TableCell>{row.dstIp}:{row.dstPort}</TableCell>
                      <TableCell className="text-muted-foreground">{row.srcNatIp || "-"}</TableCell>
                      <TableCell className="text-muted-foreground">{row.dstNatIp || "-"}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-[10px] h-5 px-1 py-0">{row.protocolName}</Badge>
                      </TableCell>
                      <TableCell className="text-right">{row.bytes}</TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={8} className="h-32 text-center text-muted-foreground font-sans">
                      {searchFlows.isIdle ? "Enter search criteria and click Search" : "No flows found matching your criteria"}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
          
          {data && data.total > 0 && (
            <div className="flex items-center justify-between px-4 py-3 border-t border-border bg-muted/20">
              <div className="text-xs text-muted-foreground">
                Showing {(page - 1) * pageSize + 1} to {Math.min(page * pageSize, data.total)} of {data.total}
              </div>
              <div className="flex gap-2">
                <Button 
                  variant="outline" 
                  size="sm" 
                  disabled={page <= 1 || searchFlows.isPending}
                  onClick={() => handlePageChange(page - 1)}
                >
                  Previous
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  disabled={page * pageSize >= data.total || searchFlows.isPending}
                  onClick={() => handlePageChange(page + 1)}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
