---
name: Auth inside the Replit preview iframe
description: Why cookie-only session auth fails in the cross-site preview and how the bearer-token bridge fixes it
---

# Session auth inside a cross-site iframe (Replit preview)

The Replit preview embeds the app in a cross-site iframe served over HTTPS.
Modern browsers block third-party cookies by default, so a session cookie —
even `SameSite=None; Secure` — is often not stored/sent inside the iframe. Symptom:
login POST returns 200 (server sets the session), but the immediately-following
`/auth/me` returns 401 because the cookie never comes back.

**What does NOT reliably fix it:** tuning the cookie (`SameSite=None; Secure`,
`credentials: "include"`). These are necessary for the first-party "open in new
tab" path but do not defeat third-party-cookie blocking in the embedded frame.

**The fix that works everywhere (iframe, new tab, plain-HTTP self-host):** accept
the session id via `Authorization: Bearer <token>` in addition to the cookie.

**Why it works:** browsers don't apply third-party-cookie policy to a header the
app sets itself from `localStorage`.

**How to apply:**
- Login returns the *signed* session-cookie value as a token (must match what
  express-session would put in the cookie: `s:` + sid + "." + base64 HMAC-SHA256
  over the sid with the session secret, trailing `=` stripped).
- A middleware running *before* express-session injects that bearer token as the
  session cookie on the request, so express-session validates it normally.
- Client stores the token in `localStorage`, registers it via the API client's
  auth-token getter, and clears it on logout.

**Why it's safe-ish:** the token is just the signed session id; revoking the
server-side session (logout/destroy) invalidates it. Tradeoff vs httpOnly cookie:
localStorage is XSS-readable.
