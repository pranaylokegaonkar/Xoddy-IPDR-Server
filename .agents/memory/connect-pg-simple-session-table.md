---
name: connect-pg-simple session table
description: Why the PG session table must be defined in Drizzle, not auto-created by connect-pg-simple.
---

Define the express-session store table (`user_sessions`) in the Drizzle schema and create it via `pnpm --filter @workspace/db run push`. Set `createTableIfMissing: false` on the connect-pg-simple `PgSession`.

**Why:** `createTableIfMissing: true` reads a bundled `table.sql` at runtime relative to the running file. After esbuild bundles the server into `dist/index.mjs`, that file does not exist, so the read throws `ENOENT .../dist/table.sql`, the table is never created, and every login issues a cookie but the session never persists (login 200, but `/auth/me` immediately 401). This bites in production (bundled server) even when dev seems to work.

**How to apply:** Any session store / library that "auto-creates its table from a packaged .sql file" is unreliable under bundling — model the table explicitly in the schema and push it.
