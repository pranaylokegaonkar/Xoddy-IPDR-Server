# Xoddy IPDR Server

A MikroTik Traffic Flow (NetFlow/IPFIX) collector and IPDR (Internet Protocol Detail Record) system built to DOT IPDR rules. It ingests flow exports from MikroTik routers over UDP, stores them, lets operators search/export records, compresses old records on a schedule, and alerts when a NAS stops generating records.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API + collector (HTTP on `PORT`, UDP collector on `NETFLOW_PORT`)
- `pnpm --filter @workspace/xoddy-ipdr run dev` — run the web UI
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL`, `SESSION_SECRET` (signs session cookies; set a long random value in production)
- Optional env:
  - `NETFLOW_PORT` (default `2055`) — UDP port the collector binds
  - `NETFLOW_HOST` (default `0.0.0.0`) — UDP bind address
  - `NETFLOW_PUBLIC_HOST` — the reachable host/IP advertised to routers in generated config commands (falls back to `REPLIT_DEV_DOMAIN`, then a `<collector-ip>` placeholder)
  - `BOOTSTRAP_ADMIN_USERNAME` / `BOOTSTRAP_ADMIN_PASSWORD` — override the default admin created on first run (defaults `admin` / `admin`)

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5; UDP collector via `node:dgram`
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Web: React + Vite, wouter routing, React Query, Recharts
- Export: `exceljs` (Excel) + plain text

## Where things live

- DB schema (source of truth): `lib/db/src/schema/` — `system-users`, `nas-devices`, `flow-records`, `notifications`, `flow-archives`, `audit-logs`, `user-sessions` (barrel `index.ts`)
- Auth: session middleware in `artifacts/api-server/src/app.ts` (express-session + connect-pg-simple, PG-backed `user_sessions`); routes `routes/auth.ts`; gate `middlewares/require-auth.ts`; bootstrap admin `lib/bootstrap.ts`; audit helper `lib/audit.ts`
- API contract (source of truth): `lib/api-spec/openapi.yaml` → codegen into `@workspace/api-zod` and `@workspace/api-hooks`
- Server routes: `artifacts/api-server/src/routes/` (dashboard, users, nas, flows, notifications, archives, auth, audit)
- Collector + parsers: `artifacts/api-server/src/lib/collector.ts`
- Background jobs (compression, stale-NAS notify): `artifacts/api-server/src/lib/jobs.ts`
- Query filtering: `artifacts/api-server/src/lib/flow-filters.ts`
- Web pages: `artifacts/xoddy-ipdr/src/pages/`

## Architecture decisions

- **Collector parses v1/v5 by fixed layout, v9/IPFIX via a runtime template cache** keyed by `exporterIp:observationDomain:templateId`. Data records can only be decoded after their template arrives, which is standard NetFlow behavior.
- **Flow timestamps derive from the exporter**, not collector receipt time: v1/v5 compute absolute times from header `unix_secs`/`sysUptime` + per-record first/last; v9 uses FIRST/LAST_SWITCHED relative to boot time; IPFIX uses flowStart/End milliseconds/seconds. `flowDate` is derived from the flow start.
- **Compression is durable, atomic, and bucketed into fixed IST 2-hour windows.** Every 2h the job groups unarchived records by the IST (UTC+5:30) wall-clock 2-hour window their `end_time` falls into (00:00–02:00, 02:00–04:00, … IST) and writes one `flow_archives` row per fully-elapsed window. It processes **one window per transaction, oldest-first** (find the earliest unarchived `end_time`, archive just that window, repeat) so a large first-time backlog is committed incrementally and never loads more than one window's records into memory — a single all-windows transaction over a huge backlog caused an nginx 504 and risked OOM. Each window's records are gzipped and the base64 payload is stored inside its transaction; only that exact frozen set of row IDs is then marked `archived`, so the payload and the archived rows always match. Windows use half-open intervals (`[start, end)` — a flow ending exactly on a boundary belongs to the next window) and are deferred by a 15-min grace after closing so late-trailing exports land in the right batch. No DB uniqueness is enforced on the window on purpose: a late record arriving after its window was archived produces a second (harmless, id-keyed) archive rather than being dropped — never drop records for an IPDR system.
- **Manual "Compress Now" runs in the background.** `POST /archives/compress` does **zero synchronous DB work**: it fires `runCompression()` without awaiting it and responds `202` immediately. `runCompression()` self-guards against overlapping runs and `compressBacklog()` is a safe no-op when no window is ready, so the handler never needs a pre-check query. The handler must never touch `flow_records` synchronously — a large backlog or an unindexed scan can outlast the reverse-proxy request timeout and surface as a 504. Archives appear in the list window-by-window as each completes.
- **Time-of-day search filters** map start/end inputs to the `start_time`/`end_time` columns respectively (via `to_char(..., 'HH24:MI')`).
- **Config command generator** advertises `NETFLOW_PUBLIC_HOST` (never the `0.0.0.0` bind address) as the router target.

## Product

- Dashboard: 24h flow totals, data volume, active/inactive NAS, unread alerts, flow-volume trend, top NAS and top talkers.
- NAS devices: add, enable/disable, sync, and generate copy-paste MikroTik `/ip traffic-flow` config per device (v1/v5/v9/IPFIX).
- Search Flows: filter by Src/Dst IP, NAT IPs, date, NAS, and start/end time-of-day; export results as text or Excel.
- Archives: list of compressed 2h batches with record counts and compression ratios, plus a live progress banner during a run (current file/window, elapsed, estimated remaining, % complete, windows done) polled from `GET /archives/compress/status`.
- Users & user types; Notifications including "no records generating" alerts.
- Authentication: username/password login, PG-backed sessions (8h), and logout. The whole UI is gated behind login; a default admin is bootstrapped on first run if no users exist. Auth works via either the session cookie OR an `Authorization: Bearer <token>` token (the signed session id, returned by login and stored in `localStorage`), so login works even inside the cross-site Replit preview iframe where browsers block third-party cookies.
- System Log: audit trail of logins (incl. failed attempts), logouts, and user/NAS create-update-delete plus flow exports.

## User preferences

_None recorded yet._

## Gotchas

- v9/IPFIX records won't appear until the router has sent its template; the cache resets on server restart, so routers must re-send templates (MikroTik does this on `v9-template-refresh`/timeout).
- All endpoints except `/api/healthz` and `/api/auth/login` require an authenticated session. The default bootstrap admin is `admin` / `admin` — sign in and change it immediately (or set `BOOTSTRAP_ADMIN_*` before first run).
- Session auth accepts the session id via cookie OR `Authorization: Bearer <token>`. A pre-session middleware (`lib/session.ts` `bearerSessionBridge`) injects the bearer token as the session cookie before express-session parses the request, so the token must be the *signed* cookie value (`signSessionId` reproduces express-session's HMAC). This is what makes login work in the cross-site preview iframe; do not remove it.
- The `user_sessions` table is defined in Drizzle and created by `pnpm --filter @workspace/db run push` — do NOT rely on connect-pg-simple's `createTableIfMissing` (it reads a `table.sql` that doesn't exist in the bundled `dist`).
- Run `pnpm --filter @workspace/db run push` after editing any `lib/db/src/schema/` file.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
