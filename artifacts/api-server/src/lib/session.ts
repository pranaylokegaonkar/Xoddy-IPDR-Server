import crypto from "node:crypto";
import type { Request, Response, NextFunction } from "express";

export const SESSION_COOKIE_NAME = "xoddy.sid";

/**
 * The secret used to sign session cookies. Mirrors the fallback used when
 * configuring express-session so that tokens we sign here validate there.
 */
export function getSessionSecret(): string {
  return process.env.SESSION_SECRET ?? "xoddy-dev-insecure-secret";
}

/**
 * Reproduces the signed cookie value express-session stores: `s:` followed by
 * the session id and an HMAC-SHA256 signature (base64, trailing `=` stripped).
 */
export function signSessionId(sessionId: string): string {
  const hash = crypto
    .createHmac("sha256", getSessionSecret())
    .update(sessionId)
    .digest("base64")
    .replace(/=+$/, "");
  return `s:${sessionId}.${hash}`;
}

/**
 * Lets the session id arrive via `Authorization: Bearer <token>` in addition to
 * the cookie. Required inside the Replit preview, where the app runs in a
 * cross-site iframe and browsers block the third-party session cookie. The
 * token is the same signed value express-session would set in the cookie, so we
 * inject it as the cookie before the session middleware parses the request.
 */
export function bearerSessionBridge(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const auth = req.headers.authorization;
  const hasCookie = req.headers.cookie?.includes(`${SESSION_COOKIE_NAME}=`);
  if (!hasCookie && auth?.startsWith("Bearer ")) {
    const token = auth.slice("Bearer ".length).trim();
    if (token) {
      const injected = `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`;
      req.headers.cookie = req.headers.cookie
        ? `${req.headers.cookie}; ${injected}`
        : injected;
    }
  }
  next();
}
