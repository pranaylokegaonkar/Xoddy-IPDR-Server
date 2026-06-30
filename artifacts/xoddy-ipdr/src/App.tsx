import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useGetCurrentUser, getGetCurrentUserQueryKey } from "@workspace/api-client-react";
import { Loader2 } from "lucide-react";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Shell } from "@/components/layout/shell";
import { CurrentUserContext } from "@/lib/auth";
import Login from "@/pages/login";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import Flows from "@/pages/flows";
import NasList from "@/pages/nas";
import UsersList from "@/pages/users";
import SystemLog from "@/pages/system-log";
import ArchiveLogs from "@/pages/archive-logs";
import Notifications from "@/pages/notifications";
import Archives from "@/pages/archives";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function Router() {
  return (
    <Shell>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/flows" component={Flows} />
        <Route path="/nas" component={NasList} />
        <Route path="/users" component={UsersList} />
        <Route path="/system-log" component={SystemLog} />
        <Route path="/archive-logs" component={ArchiveLogs} />
        <Route path="/notifications" component={Notifications} />
        <Route path="/archives" component={Archives} />
        <Route component={NotFound} />
      </Switch>
    </Shell>
  );
}

function AuthGate() {
  const { data: user, isLoading, isError } = useGetCurrentUser({
    query: {
      queryKey: getGetCurrentUserQueryKey(),
      retry: false,
      refetchOnWindowFocus: false,
    },
  });

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-muted/30">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (isError || !user) {
    return <Login />;
  }

  return (
    <CurrentUserContext.Provider value={user}>
      <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
        <Router />
      </WouterRouter>
    </CurrentUserContext.Provider>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthGate />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
