import React from "react";
import { Link, useLocation } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { useLogout, getGetCurrentUserQueryKey } from "@workspace/api-client-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarTrigger,
  useSidebar
} from "@/components/ui/sidebar";
import { Button } from "@/components/ui/button";
import { Activity, Archive, Bell, LayoutDashboard, LogOut, ScrollText, Search, Server, Users } from "lucide-react";
import { useCurrentUser } from "@/lib/auth";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0]!.slice(0, 2).toUpperCase();
  return (parts[0]![0]! + parts[parts.length - 1]![0]!).toUpperCase();
}

export function AppSidebar() {
  const [location] = useLocation();
  const queryClient = useQueryClient();
  const user = useCurrentUser();
  const logout = useLogout();

  const handleLogout = () => {
    logout.mutate(undefined, {
      onSettled: () => {
        queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
      },
    });
  };

  const navItems = [
    { title: "Dashboard", href: "/", icon: LayoutDashboard },
    { title: "Search Flows", href: "/flows", icon: Search },
    { title: "NAS Devices", href: "/nas", icon: Server },
    { title: "Archives", href: "/archives", icon: Archive },
    { title: "Users", href: "/users", icon: Users },
    { title: "System Log", href: "/system-log", icon: ScrollText },
    { title: "Notifications", href: "/notifications", icon: Bell },
  ];

  return (
    <Sidebar variant="sidebar" className="border-r border-border/50">
      <SidebarHeader className="p-4 flex items-center justify-between border-b border-sidebar-border/50 bg-sidebar text-sidebar-foreground">
        <div className="flex items-center gap-2 font-semibold">
          <div className="size-8 rounded bg-primary text-primary-foreground flex items-center justify-center">
            <Activity className="size-5" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-bold tracking-tight uppercase">Xoddy</span>
            <span className="text-[10px] text-sidebar-foreground/70 leading-none">IPDR Server</span>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent className="p-4">
        <SidebarGroup>
          <SidebarGroupLabel className="text-xs uppercase tracking-wider text-sidebar-foreground/50 mb-2 font-mono">
            Navigation
          </SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu className="gap-1.5">
              {navItems.map((item) => {
                const isActive = location === item.href || (item.href !== "/" && location.startsWith(item.href));
                return (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton
                      asChild
                      isActive={isActive}
                      tooltip={item.title}
                      className={`h-9 px-3 ${isActive ? 'bg-primary text-primary-foreground' : 'text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'}`}
                    >
                      <Link href={item.href} className="flex items-center gap-3">
                        <item.icon className="size-4" />
                        <span className="font-medium text-sm">{item.title}</span>
                      </Link>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                );
              })}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter className="p-4 border-t border-sidebar-border/50">
        <div className="flex items-center gap-3">
          <div className="size-8 rounded-full bg-sidebar-accent flex items-center justify-center text-sidebar-foreground">
            <span className="text-xs font-semibold">{initials(user.fullName || user.username)}</span>
          </div>
          <div className="flex flex-col min-w-0 flex-1">
            <span className="text-sm font-medium truncate">{user.fullName || user.username}</span>
            <span className="text-xs text-sidebar-foreground/60 capitalize">{user.userType}</span>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-8 text-sidebar-foreground/70 hover:text-sidebar-foreground"
            onClick={handleLogout}
            disabled={logout.isPending}
            title="Sign out"
          >
            <LogOut className="size-4" />
          </Button>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
