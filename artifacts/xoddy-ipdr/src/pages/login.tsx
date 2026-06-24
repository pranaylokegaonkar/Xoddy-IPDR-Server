import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useLogin, getGetCurrentUserQueryKey } from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Activity, LogIn, AlertCircle } from "lucide-react";

export default function Login() {
  const queryClient = useQueryClient();
  const login = useLogin();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    login.mutate(
      { data: { username, password } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
        },
        onError: (err: any) => {
          const message =
            err?.data?.error ?? err?.message ?? "Invalid username or password";
          setError(message);
        },
      },
    );
  };

  return (
    <div className="min-h-screen w-full flex items-center justify-center bg-muted/30 p-4">
      <div className="w-full max-w-sm">
        <div className="flex flex-col items-center mb-8">
          <div className="size-12 rounded-lg bg-primary text-primary-foreground flex items-center justify-center mb-3">
            <Activity className="size-7" />
          </div>
          <h1 className="text-2xl font-bold tracking-tight">Xoddy IPDR Server</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Sign in to access the control panel
          </p>
        </div>

        <Card className="shadow-sm border-border">
          <CardContent className="p-6">
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="username">Username</Label>
                <Input
                  id="username"
                  autoFocus
                  autoComplete="username"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="password">Password</Label>
                <Input
                  id="password"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
              </div>

              {error && (
                <div className="flex items-center gap-2 text-sm text-destructive">
                  <AlertCircle className="size-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <Button
                type="submit"
                className="w-full"
                disabled={login.isPending}
              >
                <LogIn className="size-4 mr-2" />
                {login.isPending ? "Signing in…" : "Sign In"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
