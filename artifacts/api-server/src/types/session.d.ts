import "express-session";

declare module "express-session" {
  interface SessionData {
    user?: {
      id: number;
      username: string;
      fullName: string;
      userType: "admin" | "operator" | "viewer";
      email: string | null;
    };
  }
}
