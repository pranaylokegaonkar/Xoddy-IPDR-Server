import React, { useState, useEffect, useRef } from "react";
import { useGetNasList, getGetNasListQueryKey, useCreateNas, useUpdateNas, useDeleteNas, useDeleteNasFlows, useSetNasStatus, useGetNasConfig, getGetNasConfigQueryKey, useGetNasFlowDeletionStatus, getGetNasFlowDeletionStatusQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Plus, Server, Edit, Trash2, Code, Terminal, CheckCircle2, XCircle, Copy, Eraser, Loader2 } from "lucide-react";
import { formatDistanceToNow, parseISO } from "date-fns";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";

export default function NasList() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const { data: nasList, isLoading } = useGetNasList({ query: { queryKey: getGetNasListQueryKey() } });
  
  const setStatus = useSetNasStatus();
  const deleteNas = useDeleteNas();
  const deleteNasFlows = useDeleteNasFlows();
  
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isConfigOpen, setIsConfigOpen] = useState(false);
  const [selectedNasId, setSelectedNasId] = useState<number | null>(null);

  // Live status of an in-progress unarchived-flow deletion for one NAS. Poll fast
  // while running, slow once done (the banner lingers briefly at 100%).
  const [deletingNasId, setDeletingNasId] = useState<number | null>(null);
  const { data: deletionStatus } = useGetNasFlowDeletionStatus(deletingNasId ?? 0, {
    query: {
      queryKey: getGetNasFlowDeletionStatusQueryKey(deletingNasId ?? 0),
      enabled: deletingNasId != null,
      refetchInterval: (query) =>
        (query.state.data as { running?: boolean } | undefined)?.running ? 800 : 2000,
    },
  });

  // Fire the completion toast + refresh exactly once when a run finishes.
  const wasDeleting = useRef(false);
  useEffect(() => {
    if (deletingNasId == null || !deletionStatus) return;
    if (wasDeleting.current && !deletionStatus.running) {
      wasDeleting.current = false;
      queryClient.invalidateQueries({ queryKey: getGetNasListQueryKey() });
      if (deletionStatus.lastError) {
        toast({ title: "Deletion failed", description: deletionStatus.lastError, variant: "destructive" });
      } else {
        toast({
          title: "Unarchived data deleted",
          description: `${deletionStatus.deletedCount.toLocaleString()} record(s) removed.`,
        });
      }
      const t = setTimeout(() => setDeletingNasId(null), 2500);
      return () => clearTimeout(t);
    }
    if (deletionStatus.running) wasDeleting.current = true;
    return;
  }, [deletionStatus, deletingNasId, queryClient, toast]);

  const formatDuration = (seconds: number) => {
    const s = Math.max(0, Math.floor(seconds));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
    if (m > 0) return `${m}m ${String(sec).padStart(2, "0")}s`;
    return `${sec}s`;
  };

  const deletingNas = nasList?.find((n) => n.id === deletingNasId);

  const handleToggleStatus = (id: number, enabled: boolean) => {
    setStatus.mutate(
      { id, data: { enabled } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetNasListQueryKey() });
          toast({ title: enabled ? "NAS Enabled" : "NAS Disabled" });
        },
        onError: (err: any) => {
          toast({ title: "Error", description: err.message, variant: "destructive" });
        }
      }
    );
  };

  const handleDelete = (id: number) => {
    if (confirm("Are you sure you want to delete this NAS?")) {
      deleteNas.mutate(
        { id },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getGetNasListQueryKey() });
            toast({ title: "NAS Deleted" });
          },
          onError: (err: any) => {
            toast({ title: "Error", description: err.message, variant: "destructive" });
          }
        }
      );
    }
  };

  const handleDeleteFlows = (nas: { id: number; name: string; flowCount: number }) => {
    if (nas.flowCount === 0) {
      toast({ title: "Nothing to delete", description: "This NAS has no unarchived flow records." });
      return;
    }
    if (
      confirm(
        `Delete all unarchived flow records for "${nas.name}"?\n\n` +
          `Already-archived (compressed) data is kept. This cannot be undone.`,
      )
    ) {
      deleteNasFlows.mutate(
        { id: nas.id },
        {
          onSuccess: () => {
            // Clear any stale cached status from a prior run of this NAS so the
            // poller starts fresh, then begin polling for live progress.
            queryClient.removeQueries({ queryKey: getGetNasFlowDeletionStatusQueryKey(nas.id) });
            wasDeleting.current = true;
            setDeletingNasId(nas.id);
          },
          onError: (err: any) => {
            toast({ title: "Error", description: err.message, variant: "destructive" });
          },
        },
      );
    }
  };

  const openConfig = (id: number) => {
    setSelectedNasId(id);
    setIsConfigOpen(true);
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-8 pt-8 pb-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight font-sans">NAS Devices</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage routers sending NetFlow/IPFIX data.</p>
        </div>
        <Button onClick={() => { setSelectedNasId(null); setIsFormOpen(true); }}>
          <Plus className="size-4 mr-2" /> Add NAS
        </Button>
      </div>

      {deletingNasId != null && deletionStatus && (
        <div className="px-8 pb-4">
          <Card className="border-amber-500/30 bg-amber-500/5 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center justify-between gap-4 flex-wrap">
                <div className="flex items-center gap-2 min-w-0">
                  <Loader2 className="size-4 text-amber-600 animate-spin shrink-0" />
                  <span className="text-sm font-medium">
                    {deletionStatus.running ? "Deleting unarchived data" : "Deletion complete"}
                  </span>
                  <span className="font-mono text-xs text-amber-700 truncate">
                    {deletingNas?.name ?? `NAS #${deletingNasId}`}
                  </span>
                </div>
                <div className="flex items-center gap-4 text-xs text-muted-foreground tabular-nums">
                  <span>
                    Started{" "}
                    <span className="font-medium text-foreground">
                      {deletionStatus.elapsedSeconds != null ? `${formatDuration(deletionStatus.elapsedSeconds)} ago` : "just now"}
                    </span>
                  </span>
                  <span>
                    Remaining{" "}
                    <span className="font-medium text-foreground">
                      {deletionStatus.etaSeconds != null ? `~${formatDuration(deletionStatus.etaSeconds)}` : (deletionStatus.running ? "estimating…" : "—")}
                    </span>
                  </span>
                  <span>
                    <span className="font-medium text-foreground">{deletionStatus.deletedCount.toLocaleString()}</span>
                    {" / "}
                    {deletionStatus.totalCount.toLocaleString()} deleted
                  </span>
                  <span className="font-medium text-foreground">
                    {deletionStatus.progressPercent != null ? `${deletionStatus.progressPercent}%` : "0%"}
                  </span>
                </div>
              </div>
              <div className="mt-3 h-2 w-full rounded-full bg-muted overflow-hidden">
                <div
                  className="h-full rounded-full bg-amber-500 transition-all duration-500"
                  style={{ width: `${Math.min(100, Math.max(2, deletionStatus.progressPercent ?? 0))}%` }}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="flex-1 overflow-auto px-8 pb-8">
        <Card className="shadow-sm border-border">
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow>
                  <TableHead className="font-mono text-xs">Status</TableHead>
                  <TableHead className="font-mono text-xs">Name</TableHead>
                  <TableHead className="font-mono text-xs">IP Address</TableHead>
                  <TableHead className="font-mono text-xs">Version</TableHead>
                  <TableHead className="font-mono text-xs">Last Seen</TableHead>
                  <TableHead className="font-mono text-xs">Flows</TableHead>
                  <TableHead className="font-mono text-xs text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={7} className="h-24 text-center">Loading...</TableCell></TableRow>
                ) : nasList?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-48 text-center">
                      <div className="flex flex-col items-center justify-center text-muted-foreground">
                        <Server className="size-10 mb-2 opacity-20" />
                        <p>No NAS devices configured</p>
                        <Button variant="link" onClick={() => setIsFormOpen(true)} className="mt-2">Add your first NAS</Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  nasList?.map((nas) => (
                    <TableRow key={nas.id}>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <Switch 
                            checked={nas.enabled} 
                            onCheckedChange={(checked) => handleToggleStatus(nas.id, checked)} 
                            disabled={setStatus.isPending}
                          />
                          {nas.status === 'active' ? (
                            <CheckCircle2 className="size-4 text-green-500" />
                          ) : nas.status === 'inactive' ? (
                            <XCircle className="size-4 text-red-500" />
                          ) : (
                            <span className="flex size-4 items-center justify-center rounded-full bg-muted text-[10px] font-bold text-muted-foreground">?</span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">{nas.name}</TableCell>
                      <TableCell className="font-mono text-xs">{nas.ipAddress}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="text-xs uppercase">{nas.flowVersion}</Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {nas.lastSeenAt ? formatDistanceToNow(parseISO(nas.lastSeenAt), { addSuffix: true }) : 'Never'}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{nas.flowCount.toLocaleString()}</TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-primary" onClick={() => openConfig(nas.id)} title="View Config">
                          <Terminal className="size-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setSelectedNasId(nas.id); setIsFormOpen(true); }}>
                          <Edit className="size-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-amber-600" onClick={() => handleDeleteFlows(nas)} disabled={deleteNasFlows.isPending || deletingNasId === nas.id} title="Delete unarchived flow data">
                          {deletingNasId === nas.id && deletionStatus?.running ? <Loader2 className="size-4 animate-spin" /> : <Eraser className="size-4" />}
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(nas.id)} title="Delete NAS">
                          <Trash2 className="size-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>

      {isFormOpen && (
        <NasFormModal 
          isOpen={isFormOpen} 
          onClose={() => setIsFormOpen(false)} 
          nasId={selectedNasId} 
          existingNas={nasList?.find(n => n.id === selectedNasId)}
        />
      )}

      {isConfigOpen && selectedNasId && (
        <NasConfigModal
          isOpen={isConfigOpen}
          onClose={() => setIsConfigOpen(false)}
          nasId={selectedNasId}
        />
      )}
    </div>
  );
}

function NasFormModal({ isOpen, onClose, nasId, existingNas }: any) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createNas = useCreateNas();
  const updateNas = useUpdateNas();

  const [formData, setFormData] = useState({
    name: existingNas?.name || "",
    ipAddress: existingNas?.ipAddress || "",
    location: existingNas?.location || "",
    description: existingNas?.description || "",
    flowVersion: existingNas?.flowVersion || "v9",
    enabled: existingNas?.enabled ?? true
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (nasId) {
      updateNas.mutate({ id: nasId, data: formData as any }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetNasListQueryKey() });
          toast({ title: "NAS Updated" });
          onClose();
        },
        onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" })
      });
    } else {
      createNas.mutate({ data: formData as any }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetNasListQueryKey() });
          toast({ title: "NAS Created" });
          onClose();
        },
        onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" })
      });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{nasId ? 'Edit NAS' : 'Add NAS'}</DialogTitle>
          <DialogDescription>Configure details for the router emitting flow data.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>NAS Name <span className="text-destructive">*</span></Label>
            <Input required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} placeholder="e.g. Core-Router-NY" />
          </div>
          <div className="space-y-2">
            <Label>IP Address <span className="text-destructive">*</span></Label>
            <Input required value={formData.ipAddress} onChange={e => setFormData({...formData, ipAddress: e.target.value})} placeholder="e.g. 10.0.0.1" />
            <p className="text-[10px] text-muted-foreground">The source IP address of the incoming flow packets.</p>
          </div>
          <div className="space-y-2">
            <Label>Flow Version</Label>
            <Select value={formData.flowVersion} onValueChange={(val: any) => setFormData({...formData, flowVersion: val})}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="v1">NetFlow v1</SelectItem>
                <SelectItem value="v5">NetFlow v5</SelectItem>
                <SelectItem value="v9">NetFlow v9</SelectItem>
                <SelectItem value="ipfix">IPFIX</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Location</Label>
              <Input value={formData.location} onChange={e => setFormData({...formData, location: e.target.value})} />
            </div>
            <div className="flex items-center space-x-2 pt-8">
              <Switch id="enabled" checked={formData.enabled} onCheckedChange={checked => setFormData({...formData, enabled: checked})} />
              <Label htmlFor="enabled">Enabled</Label>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Description</Label>
            <Textarea value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})} />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={createNas.isPending || updateNas.isPending}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NasConfigModal({ isOpen, onClose, nasId }: { isOpen: boolean, onClose: () => void, nasId: number }) {
  const { data: config, isLoading } = useGetNasConfig(nasId, { query: { enabled: isOpen && !!nasId, queryKey: getGetNasConfigQueryKey(nasId) } });
  const { toast } = useToast();

  const handleCopy = () => {
    if (config?.commands) {
      navigator.clipboard.writeText(config.commands.join('\n'));
      toast({ title: "Copied to clipboard" });
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Router Configuration</DialogTitle>
          <DialogDescription>Run these commands on your MikroTik router to start sending flow data.</DialogDescription>
        </DialogHeader>
        
        {isLoading ? (
          <div className="p-8 text-center">Loading...</div>
        ) : config ? (
          <div className="space-y-4">
            <div className="rounded-md bg-zinc-950 p-4 relative font-mono text-sm text-zinc-50 overflow-auto">
              <Button 
                variant="ghost" 
                size="icon" 
                className="absolute top-2 right-2 text-zinc-400 hover:text-white hover:bg-white/10 h-8 w-8"
                onClick={handleCopy}
              >
                <Copy className="size-4" />
              </Button>
              <pre className="whitespace-pre-wrap">
                {config.commands.join('\n')}
              </pre>
            </div>
            {config.notes && (
              <p className="text-sm text-muted-foreground">{config.notes}</p>
            )}
          </div>
        ) : (
          <div className="text-center text-destructive">Failed to load configuration</div>
        )}
        
        <DialogFooter>
          <Button onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
