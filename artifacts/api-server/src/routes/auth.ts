import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, systemUsersTable } from "@workspace/db";
import { LoginBody } from "@workspace/api-zod";
import { verifyPassword } from "../lib/password";
import { recordAudit } from "../lib/audit";
import { signSessionId } from "../lib/session";

/** Public routes (no authentication required). */
export const loginRouter: IRouter = Router();
/** Routes that require an authenticated session. */
export const sessionRouter: IRouter = Router();

loginRouter.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: parsed.error.issues[0]?.message ?? "Invalid input" });
    return;
  }
  const { username, password } = parsed.data;

  const [user] = await db
    .select()
    .from(systemUsersTable)
    .where(eq(systemUsersTable.username, username));

  if (!user || !user.enabled || !verifyPassword(password, user.passwordHash)) {
    await recordAudit(
      req,
      "auth.login_failed",
      `Failed login attempt for "${username}"`,
      { username },
    );
    res.status(401).json({ error: "Invalid username or password" });
    return;
  }

  const sessionUser = {
    id: user.id,
    username: user.username,
    fullName: user.fullName,
    userType: user.userType as "admin" | "operator" | "viewer",
    email: user.email,
  };

  // Regenerate the session ID on login to prevent session fixation: any
  // pre-authentication session identifier the client may hold is discarded.
  await new Promise<void>((resolve, reject) => {
    req.session.regenerate((err) => (err ? reject(err) : resolve()));
  });
  req.session.user = sessionUser;
  await new Promise<void>((resolve, reject) => {
    req.session.save((err) => (err ? reject(err) : resolve()));
  });

  await db
    .update(systemUsersTable)
    .set({ lastLoginAt: new Date() })
    .where(eq(systemUsersTable.id, user.id));

  await recordAudit(req, "auth.login", `${user.username} signed in`);

  // Also hand the client a bearer token (the signed session id) so it can
  // authenticate without the session cookie — required inside the cross-site
  // Replit preview iframe where browsers block third-party cookies.
  res.json({ ...sessionUser, token: signSessionId(req.sessionID) });
});

sessionRouter.get("/auth/me", (req, res) => {
  res.json(req.session.user);
});

sessionRouter.post("/auth/logout", async (req, res): Promise<void> => {
  const user = req.session.user;
  await recordAudit(
    req,
    "auth.logout",
    user ? `${user.username} signed out` : undefined,
  );
  req.session.destroy((err) => {
    if (err) {
      req.log.error({ err }, "Failed to destroy session");
      res.status(500).json({ error: "Failed to log out" });
      return;
    }
    res.clearCookie("xoddy.sid");
    res.status(204).send();
  });
});
