import React, { useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import {
  useGetAuditLogs,
  getGetAuditLogsQueryKey,
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
  ScrollText,
  LogIn,
  LogOut,
  ShieldAlert,
  ChevronLeft,
  ChevronRight,
} from "lucide-react";
import { format, parseISO } from "date-fns";

const PAGE_SIZE = 50;

function actionMeta(action: string): {
  label: string;
  variant: "default" | "secondary" | "destructive" | "outline";
} {
  switch (action) {
    case "auth.login":
      return { label: "Sign in", variant: "default" };
    case "auth.logout":
      return { label: "Sign out", variant: "secondary" };
    case "auth.login_failed":
      return { label: "Failed login", variant: "destructive" };
    case "user.create":
      return { label: "User created", variant: "outline" };
    case "user.update":
      return { label: "User updated", variant: "outline" };
    case "user.delete":
      return { label: "User deleted", variant: "destructive" };
    case "nas.create":
      return { label: "NAS added", variant: "outline" };
    case "nas.update":
      return { label: "NAS updated", variant: "outline" };
    case "nas.status":
      return { label: "NAS status", variant: "outline" };
    case "nas.delete":
      return { label: "NAS deleted", variant: "destructive" };
    case "flow.export":
      return { label: "Flow export", variant: "secondary" };
    default:
      return { label: action, variant: "outline" };
  }
}

export default function SystemLog() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useGetAuditLogs(
    { page, pageSize: PAGE_SIZE },
    {
      query: {
        queryKey: getGetAuditLogsQueryKey({ page, pageSize: PAGE_SIZE }),
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
          <h1 className="text-3xl font-bold tracking-tight font-sans">System Log</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Audit trail of user logins and actions.
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
                  <TableHead className="font-mono text-xs">User</TableHead>
                  <TableHead className="font-mono text-xs">Action</TableHead>
                  <TableHead className="font-mono text-xs">Details</TableHead>
                  <TableHead className="font-mono text-xs">IP Address</TableHead>
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
                        <ScrollText className="size-10 mb-2 opacity-20" />
                        <p>No activity recorded yet</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  logs.map((log) => {
                    const meta = actionMeta(log.action);
                    return (
                      <TableRow key={log.id}>
                        <TableCell className="text-xs text-muted-foreground whitespace-nowrap">
                          {format(parseISO(log.createdAt), "MMM d, yyyy HH:mm:ss")}
                        </TableCell>
                        <TableCell className="font-medium font-mono text-sm">
                          {log.username}
                        </TableCell>
                        <TableCell>
                          <Badge variant={meta.variant} className="text-xs">
                            {log.action === "auth.login" && (
                              <LogIn className="size-3 mr-1" />
                            )}
                            {log.action === "auth.logout" && (
                              <LogOut className="size-3 mr-1" />
                            )}
                            {log.action === "auth.login_failed" && (
                              <ShieldAlert className="size-3 mr-1" />
                            )}
                            {meta.label}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {log.detail ?? "—"}
                        </TableCell>
                        <TableCell className="text-xs font-mono text-muted-foreground">
                          {log.ipAddress ?? "—"}
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
