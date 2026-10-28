import { useState } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CurrentFlowSearch } from "@/components/flows/current-flow-search";
import { OldSearch } from "@/components/flows/old-search";

export default function Flows() {
  const [mode, setMode] = useState("current");

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
      <Tabs value={mode} onValueChange={setMode} className="flex-1 flex flex-col overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-4 px-8 pt-8 pb-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight font-sans">Search Flows</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {mode === "current"
                ? "IP Detail Records for lawful retention and analysis."
                : "Search compressed archives through a temporary, session-locked workspace."}
            </p>
          </div>
          <TabsList>
            <TabsTrigger value="current">Current Day Search</TabsTrigger>
            <TabsTrigger value="old">Old Search</TabsTrigger>
          </TabsList>
        </div>
        <div className="flex-1 overflow-auto px-8 pb-8">
          <TabsContent value="current" forceMount hidden={mode !== "current"} className="mt-0">
            <CurrentFlowSearch />
          </TabsContent>
          <TabsContent value="old" className="mt-0">
            <OldSearch />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
