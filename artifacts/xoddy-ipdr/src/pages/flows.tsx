import { useLocation } from "wouter";
import { CurrentFlowSearch } from "@/components/flows/current-flow-search";
import { OldSearch } from "@/components/flows/old-search";

export default function Flows() {
  const [location] = useLocation();
  const mode = location === "/flows/old" ? "old" : "current";

  return (
    <div className="flex-1 flex flex-col h-full overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-4 px-8 pt-8 pb-4">
          <div>
            <h1 className="text-3xl font-bold tracking-tight font-sans">
              {mode === "current" ? "Current Day Search" : "Old Search"}
            </h1>
            <p className="text-muted-foreground text-sm mt-1">
              {mode === "current"
                ? "IP Detail Records for lawful retention and analysis."
                : "Search compressed archives through a temporary, session-locked workspace."}
            </p>
          </div>
        </div>
        <div className="flex-1 overflow-auto px-8 pb-8">
          <div hidden={mode !== "current"}>
            <CurrentFlowSearch />
          </div>
          {mode === "old" && <OldSearch />}
        </div>
    </div>
  );
}
