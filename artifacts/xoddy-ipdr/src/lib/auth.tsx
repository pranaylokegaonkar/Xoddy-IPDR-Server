import { createContext, useContext } from "react";
import type { CurrentUser } from "@workspace/api-client-react";

export const CurrentUserContext = createContext<CurrentUser | null>(null);

export function useCurrentUser(): CurrentUser {
  const ctx = useContext(CurrentUserContext);
  if (!ctx) {
    throw new Error("useCurrentUser must be used within an authenticated tree");
  }
  return ctx;
}
