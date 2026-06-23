import React, { useState } from "react";
import { useGetUsers, getGetUsersQueryKey, useCreateUser, useUpdateUser, useDeleteUser, useGetUserTypes } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Plus, Users as UsersIcon, Edit, Trash2, Shield } from "lucide-react";
import { formatDistanceToNow, parseISO, format } from "date-fns";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

export default function UsersList() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  
  const { data: users, isLoading } = useGetUsers({ query: { queryKey: getGetUsersQueryKey() } });
  
  const deleteUser = useDeleteUser();
  const updateUser = useUpdateUser();
  
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);

  const handleToggleStatus = (id: number, enabled: boolean) => {
    updateUser.mutate(
      { id, data: { enabled } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetUsersQueryKey() });
          toast({ title: enabled ? "User Enabled" : "User Disabled" });
        },
        onError: (err: any) => {
          toast({ title: "Error", description: err.message, variant: "destructive" });
        }
      }
    );
  };

  const handleDelete = (id: number) => {
    if (confirm("Are you sure you want to delete this user?")) {
      deleteUser.mutate(
        { id },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: getGetUsersQueryKey() });
            toast({ title: "User Deleted" });
          },
          onError: (err: any) => {
            toast({ title: "Error", description: err.message, variant: "destructive" });
          }
        }
      );
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <div className="flex items-center justify-between px-8 pt-8 pb-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight font-sans">System Users</h1>
          <p className="text-muted-foreground text-sm mt-1">Manage operators and admins.</p>
        </div>
        <Button onClick={() => { setSelectedUserId(null); setIsFormOpen(true); }}>
          <Plus className="size-4 mr-2" /> Add User
        </Button>
      </div>

      <div className="flex-1 overflow-auto px-8 pb-8">
        <Card className="shadow-sm border-border">
          <CardContent className="p-0">
            <Table>
              <TableHeader className="bg-muted/30">
                <TableRow>
                  <TableHead className="font-mono text-xs">Status</TableHead>
                  <TableHead className="font-mono text-xs">Username</TableHead>
                  <TableHead className="font-mono text-xs">Full Name</TableHead>
                  <TableHead className="font-mono text-xs">Role</TableHead>
                  <TableHead className="font-mono text-xs">Last Login</TableHead>
                  <TableHead className="font-mono text-xs">Created</TableHead>
                  <TableHead className="font-mono text-xs text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow><TableCell colSpan={7} className="h-24 text-center">Loading...</TableCell></TableRow>
                ) : users?.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="h-48 text-center">
                      <div className="flex flex-col items-center justify-center text-muted-foreground">
                        <UsersIcon className="size-10 mb-2 opacity-20" />
                        <p>No users found</p>
                      </div>
                    </TableCell>
                  </TableRow>
                ) : (
                  users?.map((user) => (
                    <TableRow key={user.id}>
                      <TableCell>
                        <Switch 
                          checked={user.enabled} 
                          onCheckedChange={(checked) => handleToggleStatus(user.id, checked)} 
                          disabled={updateUser.isPending}
                        />
                      </TableCell>
                      <TableCell className="font-medium font-mono">{user.username}</TableCell>
                      <TableCell>{user.fullName}</TableCell>
                      <TableCell>
                        <Badge variant={user.userType === 'admin' ? 'default' : 'secondary'} className="text-xs uppercase">
                          {user.userType === 'admin' && <Shield className="size-3 mr-1" />}
                          {user.userType}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {user.lastLoginAt ? formatDistanceToNow(parseISO(user.lastLoginAt), { addSuffix: true }) : 'Never'}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {format(parseISO(user.createdAt), "MMM d, yyyy")}
                      </TableCell>
                      <TableCell className="text-right space-x-2">
                        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => { setSelectedUserId(user.id); setIsFormOpen(true); }}>
                          <Edit className="size-4" />
                        </Button>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => handleDelete(user.id)} disabled={user.username === 'admin'}>
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
        <UserFormModal 
          isOpen={isFormOpen} 
          onClose={() => setIsFormOpen(false)} 
          userId={selectedUserId} 
          existingUser={users?.find(u => u.id === selectedUserId)}
        />
      )}
    </div>
  );
}

function UserFormModal({ isOpen, onClose, userId, existingUser }: any) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const { data: userTypes } = useGetUserTypes();

  const [formData, setFormData] = useState({
    username: existingUser?.username || "",
    fullName: existingUser?.fullName || "",
    email: existingUser?.email || "",
    userType: existingUser?.userType || "operator",
    password: "",
    enabled: existingUser?.enabled ?? true
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (userId) {
      const updateData: any = {
        fullName: formData.fullName,
        email: formData.email,
        userType: formData.userType,
        enabled: formData.enabled
      };
      if (formData.password) updateData.password = formData.password;
      
      updateUser.mutate({ id: userId, data: updateData }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetUsersQueryKey() });
          toast({ title: "User Updated" });
          onClose();
        },
        onError: (err: any) => toast({ title: "Error", description: err.message, variant: "destructive" })
      });
    } else {
      if (!formData.password) {
        toast({ title: "Validation Error", description: "Password is required for new users", variant: "destructive" });
        return;
      }
      createUser.mutate({ data: formData as any }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetUsersQueryKey() });
          toast({ title: "User Created" });
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
          <DialogTitle>{userId ? 'Edit User' : 'Add User'}</DialogTitle>
          <DialogDescription>System users have access to this control panel.</DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Username {!userId && <span className="text-destructive">*</span>}</Label>
            <Input required={!userId} disabled={!!userId} value={formData.username} onChange={e => setFormData({...formData, username: e.target.value})} />
          </div>
          <div className="space-y-2">
            <Label>Full Name <span className="text-destructive">*</span></Label>
            <Input required value={formData.fullName} onChange={e => setFormData({...formData, fullName: e.target.value})} />
          </div>
          <div className="space-y-2">
            <Label>Email</Label>
            <Input type="email" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
          </div>
          <div className="space-y-2">
            <Label>Role</Label>
            <Select value={formData.userType} onValueChange={(val: any) => setFormData({...formData, userType: val})}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {userTypes?.map((t) => (
                  <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Password {!userId && <span className="text-destructive">*</span>}</Label>
            <Input type="password" value={formData.password} onChange={e => setFormData({...formData, password: e.target.value})} placeholder={userId ? "Leave blank to keep unchanged" : ""} />
          </div>
          <div className="flex items-center space-x-2 pt-2">
            <Switch id="user-enabled" checked={formData.enabled} onCheckedChange={checked => setFormData({...formData, enabled: checked})} />
            <Label htmlFor="user-enabled">Account Active</Label>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={createUser.isPending || updateUser.isPending}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
