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
- **Compression is durable and atomic.** Every 2h, eligible records (older than 2h, not yet archived) are selected, gzipped, and the base64 payload is stored on the `flow_archives` row inside a single transaction; only that exact frozen set of row IDs is then marked `archived`, so the payload and the archived rows always match.
- **Time-of-day search filters** map start/end inputs to the `start_time`/`end_time` columns respectively (via `to_char(..., 'HH24:MI')`).
- **Config command generator** advertises `NETFLOW_PUBLIC_HOST` (never the `0.0.0.0` bind address) as the router target.

## Product

- Dashboard: 24h flow totals, data volume, active/inactive NAS, unread alerts, flow-volume trend, top NAS and top talkers.
- NAS devices: add, enable/disable, sync, and generate copy-paste MikroTik `/ip traffic-flow` config per device (v1/v5/v9/IPFIX).
- Search Flows: filter by Src/Dst IP, NAT IPs, date, NAS, and start/end time-of-day; export results as text or Excel.
- Archives: list of compressed 2h batches with record counts and compression ratios.
- Users & user types; Notifications including "no records generating" alerts.
- Authentication: username/password login, PG-backed sessions (8h), and logout. The whole UI is gated behind login; a default admin is bootstrapped on first run if no users exist.
- System Log: audit trail of logins (incl. failed attempts), logouts, and user/NAS create-update-delete plus flow exports.

## User preferences

_None recorded yet._

## Gotchas

- v9/IPFIX records won't appear until the router has sent its template; the cache resets on server restart, so routers must re-send templates (MikroTik does this on `v9-template-refresh`/timeout).
- All endpoints except `/api/healthz` and `/api/auth/login` require an authenticated session. The default bootstrap admin is `admin` / `admin` — sign in and change it immediately (or set `BOOTSTRAP_ADMIN_*` before first run).
- The `user_sessions` table is defined in Drizzle and created by `pnpm --filter @workspace/db run push` — do NOT rely on connect-pg-simple's `createTableIfMissing` (it reads a `table.sql` that doesn't exist in the bundled `dist`).
- Run `pnpm --filter @workspace/db run push` after editing any `lib/db/src/schema/` file.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
