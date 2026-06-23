import React from "react";
import { useGetNotifications, getGetNotificationsQueryKey, useMarkNotificationRead, useMarkAllNotificationsRead, getGetDashboardSummaryQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Bell, Check, CheckCircle2, AlertTriangle, Info, AlertOctagon } from "lucide-react";
import { formatDistanceToNow, parseISO } from "date-fns";
import { useToast } from "@/hooks/use-toast";

export default function Notifications() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const { data: notifications, isLoading } = useGetNotifications({ query: { queryKey: getGetNotificationsQueryKey() } });
  
  const markRead = useMarkNotificationRead();
  const markAllRead = useMarkAllNotificationsRead();

  const handleMarkRead = (id: number) => {
    markRead.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetNotificationsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
      }
    });
  };

  const handleMarkAllRead = () => {
    markAllRead.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetNotificationsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetDashboardSummaryQueryKey() });
        toast({ title: "All notifications marked as read" });
      }
    });
  };

  const getIcon = (severity: string) => {
    switch(severity) {
      case 'critical': return <AlertOctagon className="size-5 text-destructive" />;
      case 'warning': return <AlertTriangle className="size-5 text-amber-500" />;
      default: return <Info className="size-5 text-primary" />;
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-8 pt-8 pb-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight font-sans">Alerts & Notifications</h1>
          <p className="text-muted-foreground text-sm mt-1">System events and NAS operational alerts.</p>
        </div>
        <Button variant="outline" onClick={handleMarkAllRead} disabled={markAllRead.isPending || !notifications?.some(n => !n.read)}>
          <CheckCircle2 className="size-4 mr-2" /> Mark All Read
        </Button>
      </div>

      <div className="flex-1 overflow-auto px-8 pb-8 max-w-4xl mx-auto w-full">
        {isLoading ? (
          <div className="space-y-4">
            {[1, 2, 3].map(i => (
              <Card key={i} className="shadow-sm border-border"><CardContent className="h-24"></CardContent></Card>
            ))}
          </div>
        ) : notifications?.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
            <Bell className="size-12 mb-4 opacity-20" />
            <h3 className="text-lg font-medium">All caught up</h3>
            <p className="text-sm">No new notifications to display.</p>
          </div>
        ) : (
          <div className="space-y-3">
            {notifications?.map((notification) => (
              <Card key={notification.id} className={`shadow-sm transition-all duration-200 ${notification.read ? 'bg-muted/30 border-transparent opacity-75' : 'border-border shadow-md'}`}>
                <CardContent className="p-4 flex gap-4">
                  <div className="pt-1">
                    {getIcon(notification.severity)}
                  </div>
                  <div className="flex-1 space-y-1">
                    <div className="flex justify-between items-start">
                      <h4 className={`text-base font-semibold ${notification.read ? 'text-foreground/80' : 'text-foreground'}`}>
                        {notification.title}
                      </h4>
                      <div className="text-xs text-muted-foreground whitespace-nowrap ml-4">
                        {formatDistanceToNow(parseISO(notification.createdAt), { addSuffix: true })}
                      </div>
                    </div>
                    <p className={`text-sm ${notification.read ? 'text-muted-foreground' : 'text-foreground/90'}`}>
                      {notification.message}
                    </p>
                    <div className="flex items-center gap-2 pt-2">
                      <Badge variant="outline" className="text-[10px] uppercase font-mono bg-background">
                        {notification.type.replace('_', ' ')}
                      </Badge>
                      {notification.nasId && (
                        <Badge variant="secondary" className="text-[10px]">NAS ID: {notification.nasId}</Badge>
                      )}
                    </div>
                  </div>
                  {!notification.read && (
                    <div className="flex items-center">
                      <Button variant="ghost" size="icon" onClick={() => handleMarkRead(notification.id)} title="Mark as read" className="h-8 w-8 text-primary">
                        <Check className="size-4" />
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
