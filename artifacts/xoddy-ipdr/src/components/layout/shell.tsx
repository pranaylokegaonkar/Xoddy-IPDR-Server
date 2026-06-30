import React from "react";
import { Activity } from "lucide-react";
import { AppSidebar } from "./sidebar";
import { SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";

export function Shell({ children }: { children: React.ReactNode }) {
  return (
    <SidebarProvider defaultOpen={true}>
      <div className="min-h-screen flex w-full bg-background">
        <AppSidebar />
        <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
          {/* Mobile-only top bar. Below md the sidebar collapses to an
              off-canvas sheet, so it needs a visible trigger to open; on md+ the
              sidebar is always docked and this bar is hidden. */}
          <header className="md:hidden flex items-center gap-3 h-14 shrink-0 border-b border-border bg-background px-4">
            <SidebarTrigger className="size-9 -ml-1" />
            <div className="flex items-center gap-2 font-semibold">
              <div className="size-7 rounded bg-primary text-primary-foreground flex items-center justify-center">
                <Activity className="size-4" />
              </div>
              <span className="text-sm font-bold tracking-tight uppercase">
                Xoddy IPDR
              </span>
            </div>
          </header>
          {children}
        </main>
      </div>
    </SidebarProvider>
  );
}
