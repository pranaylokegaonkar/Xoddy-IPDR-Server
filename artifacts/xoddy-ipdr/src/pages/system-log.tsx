import React from "react";
import { useGetAuditLogs } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ScrollText, LogIn, LogOut, ShieldAlert } from "lucide-react";
import { format, parseISO } from "date-fns";

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
  const { data: logs, isLoading } = useGetAuditLogs({ limit: 500 });

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
                ) : logs?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={5} className="h-48 text-center">
                      <div className="flex flex-col items-center justify-center text-muted-foreground">
                        <ScrollText className="size-10 mb-2 opacity-20" />
                        <p>No activity recorded yet</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  logs?.map((log) => {
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
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
