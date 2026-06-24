const STORAGE_KEY = "xoddy.token";

/**
 * Bearer token (signed session id) used to authenticate API requests without
 * relying on the session cookie. This is what makes login work inside the
 * Replit preview iframe, where browsers block third-party cookies.
 */
export function getToken(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}

export function setToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(STORAGE_KEY, token);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    /* ignore storage failures (e.g. disabled in a locked-down browser) */
  }
}
