import React, { useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import {
  useGetArchiveLogs,
  getGetArchiveLogsQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  FileClock,
  ChevronLeft,
  ChevronRight,
  Archive,
  Trash2,
  Play,
  CheckCircle2,
  AlertTriangle,
} from "lucide-react";
import { format, parseISO } from "date-fns";

const PAGE_SIZE = 50;

function levelMeta(level: string): {
  variant: "default" | "secondary" | "destructive" | "outline";
  className?: string;
} {
  switch (level) {
    case "error":
      return { variant: "destructive" };
    case "warning":
      return {
        variant: "outline",
        className: "border-amber-500 text-amber-600",
      };
    default:
      return { variant: "secondary" };
  }
}

function eventMeta(event: string): { label: string; icon: React.ReactNode } {
  switch (event) {
    case "compression.trigger":
      return { label: "Compression requested", icon: <Play className="size-3 mr-1" /> };
    case "compression.window":
      return { label: "Window archived", icon: <Archive className="size-3 mr-1" /> };
    case "compression.complete":
      return {
        label: "Compression complete",
        icon: <CheckCircle2 className="size-3 mr-1" />,
      };
    case "compression.error":
      return {
        label: "Compression error",
        icon: <AlertTriangle className="size-3 mr-1" />,
      };
    case "archive.delete":
      return { label: "Archive deleted", icon: <Trash2 className="size-3 mr-1" /> };
    default:
      return { label: event, icon: null };
  }
}

export default function ArchiveLogs() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useGetArchiveLogs(
    { page, pageSize: PAGE_SIZE },
    {
      query: {
        queryKey: getGetArchiveLogsQueryKey({ page, pageSize: PAGE_SIZE }),
        placeholderData: keepPreviousData,
      },
    },
  );

  const logs = data?.items ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-8 pt-8 pb-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight font-sans">
            Archive Logs
          </h1>
          <p className="text-muted-foreground text-sm mt-1">
            Compression and archiving activity, including any errors.
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-auto px-8 pb-8">
        <Card className="shadow-sm border-border">
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow>
                  <TableHead className="font-mono text-xs">Time</TableHead>
                  <TableHead className="font-mono text-xs">Level</TableHead>
                  <TableHead className="font-mono text-xs">Event</TableHead>
                  <TableHead className="font-mono text-xs">Message</TableHead>
                  <TableHead className="font-mono text-xs">Detail</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center">
                      Loading…
                    </TableCell>
                  </TableRow>
                ) : logs.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-48 text-center">
                      <div className="flex flex-col items-center justify-center text-muted-foreground">
                        <FileClock className="size-10 mb-2 opacity-20" />
                        <p>No archive activity recorded yet</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((log) => {
                    const lvl = levelMeta(log.level);
                    const evt = eventMeta(log.event);
                    return (
                      <TableRow key={log.id}>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {format(parseISO(log.createdAt), "MMM d, yyyy HH:mm:ss")}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={lvl.variant}
                            className={`text-xs capitalize ${lvl.className ?? ""}`}
                          >
                            {log.level}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {evt.icon}
                            {evt.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-foreground">
                          {log.message}
                        </TableCell>
                        <TableCell className="text-xs font-mono text-muted-foreground max-w-md truncate">
                          {log.detail ?? "—"}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>

            {total > 0 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-border">
                <p className="text-xs text-muted-foreground">
                  Showing {(page - 1) * PAGE_SIZE + 1} to{" "}
                  {Math.min(page * PAGE_SIZE, total)} of {total}
                </p>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs font-medium"
                    disabled={page <= 1}
                    onClick={() => setPage((p) => Math.max(1, p - 1))}
                  >
                    <ChevronLeft className="size-4 mr-1" />
                    Previous
                  </Button>
                  <span className="text-xs text-muted-foreground">
                    Page {page} of {totalPages}
                  </span>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs font-medium"
                    disabled={page >= totalPages}
                    onClick={() => setPage((p) => p + 1)}
                  >
                    Next
                    <ChevronRight className="size-4 ml-1" />
                  </Button>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
