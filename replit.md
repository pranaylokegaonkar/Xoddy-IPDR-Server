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
  - `ARCHIVE_STORAGE_DIR` — optional absolute path to a Windows SMB share mounted on the Linux host; when configured, new archive files are copied there and their PostgreSQL payloads are cleared only after a successful write
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

- DB schema (source of truth): `lib/db/src/schema/` — `system-users`, `nas-devices`, `flow-records`, `notifications`, `flow-archives`, `audit-logs`, `archive-logs`, `user-sessions` (barrel `index.ts`)
- Auth: session middleware in `artifacts/api-server/src/app.ts` (express-session + connect-pg-simple, PG-backed `user_sessions`); routes `routes/auth.ts`; gate `middlewares/require-auth.ts`; bootstrap admin `lib/bootstrap.ts`; audit helper `lib/audit.ts`
- API contract (source of truth): `lib/api-spec/openapi.yaml` → codegen into `@workspace/api-zod` and `@workspace/api-hooks`
- Server routes: `artifacts/api-server/src/routes/` (dashboard, users, nas, flows, notifications, archives, archive-logs, auth, audit)
- Archive/compression activity log: `artifacts/api-server/src/lib/archive-log.ts` (`recordArchiveLog`, never throws) writes `archive_logs` rows; instrumented in `jobs.ts` (compression run/window/complete/error) and `routes/archives.ts` (manual trigger + archive deletes)
- Collector + parsers: `artifacts/api-server/src/lib/collector.ts`
- Background jobs (compression, stale-NAS notify): `artifacts/api-server/src/lib/jobs.ts`
- Background NAS unarchived-flow deletion + progress tracking: `artifacts/api-server/src/lib/nas-flow-deletion.ts`
- Query filtering: `artifacts/api-server/src/lib/flow-filters.ts`
- Web pages: `artifacts/xoddy-ipdr/src/pages/`

## Architecture decisions

- **Collector parses v1/v5 by fixed layout, v9/IPFIX via a runtime template cache** keyed by `exporterIp:observationDomain:templateId`. Data records can only be decoded after their template arrives, which is standard NetFlow behavior.
- **Flow timestamps derive from the exporter**, not collector receipt time: v1/v5 compute absolute times from header `unix_secs`/`sysUptime` + per-record first/last; v9 uses FIRST/LAST_SWITCHED relative to boot time; IPFIX uses flowStart/End milliseconds/seconds. `flowDate` is derived from the flow start.
- **Compression is durable, atomic, bucketed into fixed IST 2-hour windows, and split one archive file per NAS.** Every 2h the job groups unarchived records by the IST (UTC+5:30) wall-clock 2-hour window their `end_time` falls into (00:00–02:00, 02:00–04:00, … IST), then within each window groups by `nasId` and writes one `flow_archives` row per (NAS, window). Filenames are `<SanitizedNasName>_<ip>_<YYYY-MM-DD>_<HHMM>IST.json.gz`; archive rows carry nullable `nasId/nasName/nasIp` (null on pre-split archives, shown as "All" in the UI). All per-NAS files for a window plus the single `archived` flag update commit in that window's one transaction, so payload↔archived-row consistency holds across every file. It processes **one window per transaction, oldest-first** (find the earliest unarchived `end_time`, archive just that window, repeat) so a large first-time backlog is committed incrementally and never loads more than one window's records into memory — a single all-windows transaction over a huge backlog caused an nginx 504 and risked OOM. Each window's records are gzipped and the base64 payload is stored inside its transaction; only that exact frozen set of row IDs is then marked `archived`, so the payload and the archived rows always match. Windows use half-open intervals (`[start, end)` — a flow ending exactly on a boundary belongs to the next window) and are deferred by a 15-min grace after closing so late-trailing exports land in the right batch. No DB uniqueness is enforced on the window on purpose: a late record arriving after its window was archived produces a second (harmless, id-keyed) archive rather than being dropped — never drop records for an IPDR system.
- **Optional Windows archive share:** set `ARCHIVE_STORAGE_DIR` to a mounted SMB/CIFS directory on the Linux server before the next archive run. New archive rows retain their PostgreSQL payload until the share write succeeds; successful writes clear the new row's payload and the archive UI downloads from the share. Existing rows keep their database payload and are not moved. A 15-minute retry handles a temporarily unavailable share; failed transfers remain downloadable from PostgreSQL and are reported in Archive Logs. On Linux, the app refuses to write unless the configured directory is actually mounted as CIFS, preventing writes to the server's local mount-point directory when the share is offline. The host must mount the share before starting the API service.
- **Deleting a NAS's flow data runs in the background with pollable progress, and has two scopes.** `DELETE /nas/:id/flows` (scope `unarchived`) and `DELETE /nas/:id/flows/all` (scope `all`) both validate, fire `startNasFlowDeletion(id, name, scope)` (fire-and-forget), and respond `202 {started}` (`started:false` when a run for that NAS is already in flight — it self-guards against double-clicks and only audits when a job actually begins). They are **two separate path-only endpoints on purpose, not one endpoint with a `scope` query param**: orval emits a TS2308 duplicate-export collision (`DeleteNasFlowsParams` as both a zod path-params const and a query-params type) whenever one operation has BOTH a path param and a query param; path-only endpoints generate no `*Params` type file, so two paths sidestep it. The job (in `lib/nas-flow-deletion.ts`, in-process `Map` keyed by `nasId`) **captures an id cutoff at start** (the current max `id` for that NAS, restricted to `archived=0` for the `unarchived` scope) and only ever deletes `id <= cutoff` (plus `AND archived=0` for `unarchived`), in bounded batches. Deleting archived rows is safe: compression keeps a durable gzip copy in `flow_archives` (downloadable on the Archives page), so the `all` scope purges redundant hot-table rows without losing IPDR data. This is mandatory: flow records keep arriving during the delete, so without the cutoff the loop would re-pick post-start arrivals — never terminating AND silently destroying live records we were never asked to delete (violating the IPDR "never drop records" rule). It must never DELETE `flow_records` synchronously in the handler — millions of rows can outlast the reverse-proxy timeout and surface as a 504, the same reason compression is backgrounded. `getNasFlowDeletionStatus(nasId)` computes elapsed/percent/ETA on read.
- **Global "delete all stored data" mirrors the per-NAS background-delete pattern but only purges archived rows.** `DELETE /flows` fires `startAllFlowDeletion()` (fire-and-forget, in-process global singleton) and responds `202 {started}` (`started:false` if a run is already in flight — guards double-clicks, audits only when a run actually begins). The job (`lib/all-flow-deletion.ts`) **captures an id cutoff at start** (current max `id` where `archived=1`) and deletes only `archived=1 AND id<=cutoff` in 10k batches, so it terminates deterministically even though records keep arriving and the compression job marks more rows `archived` mid-run. It deliberately **never deletes unarchived rows** — those have no gzip copy yet, so deleting them would lose IPDR data; archived rows are safe because compression keeps a durable copy in `flow_archives`. Like compression and per-NAS delete, it must never DELETE synchronously in the handler (millions of rows → 504). `getAllFlowDeletionStatus()` computes elapsed/percent/ETA on read; an idle default (`started:false`) is returned before any run so the dashboard shows no banner.
- **Manual "Compress Now" runs in the background.** `POST /archives/compress` does **zero synchronous DB work**: it fires `runCompression()` without awaiting it and responds `202` immediately. `runCompression()` self-guards against overlapping runs and `compressBacklog()` is a safe no-op when no window is ready, so the handler never needs a pre-check query. The handler must never touch `flow_records` synchronously — a large backlog or an unindexed scan can outlast the reverse-proxy request timeout and surface as a 504. Archives appear in the list window-by-window as each completes.
- **Dashboard queries must stay cheap on a large `flow_records`.** Compression only *marks* rows `archived=1` (it never deletes them), so `flow_records` grows without bound on a live collector — the full archived history stays in the hot table. Any dashboard/list aggregate over the whole table (`count(*)`, `sum(bytes)`, `GROUP BY`) therefore becomes a full scan that times out behind nginx as data accumulates (symptom: every data widget stuck on a loading skeleton in production while ~thousands of dev rows load instantly). Rule: time-scope dashboard aggregates to a recent window and back them with an index. `flow-trend` and `top-talkers` filter `start_time >= now() - interval '24 hours'`, supported by `flow_records_start_idx` on `start_time`. Do **not** add new all-time full-table aggregate widgets; the removed "Top NAS Devices" widget was exactly that. (The unscoped `summary` total `count(*)`/`sum(bytes)` is the remaining all-time scan — revisit if it becomes a bottleneck.)
- **Time-of-day search filters** map start/end inputs to the `start_time`/`end_time` columns respectively (via `to_char(..., 'HH24:MI')`).
- **Config command generator** advertises `NETFLOW_PUBLIC_HOST` (never the `0.0.0.0` bind address) as the router target.

## Product

- Dashboard: 24h flow totals, data volume, active/inactive NAS, unread alerts, server resource usage (Disk Space + Memory/RAM used/free with a usage bar, polled every 10s from `GET /dashboard/system-resources`), flow-volume trend (24h), and top talkers (last 24h). Disk uses Node `fs.statfs(process.cwd())`; memory reads `/proc/meminfo` `MemTotal`/`MemAvailable` (matching `free -h`) and falls back to `os.totalmem()/freemem()`. (The "Top NAS Devices" widget was removed — it was an all-time full-table aggregate that didn't scale.) The Data Volume card has a **"Delete all stored data"** action: a confirm dialog fires `DELETE /flows`, which background-purges every already-archived `flow_records` row across **all** NAS (durable gzip archive files are kept; unarchived rows are left for the compression job), and a live progress banner polls `GET /flows/deletion-status`.
- NAS devices: add, enable/disable, sync, generate copy-paste MikroTik `/ip traffic-flow` config per device (v1/v5/v9/IPFIX), and delete a device's flow data. The delete button opens a dialog to pick a scope: **Unarchived only** (`DELETE /nas/:id/flows`) removes only not-yet-compressed rows and keeps archived batches; **Everything** (`DELETE /nas/:id/flows/all`) removes all flow records (archived + unarchived) — the durable gzip archive files on the Archives page are kept, so no IPDR data is lost. (The Flows column counts archived + unarchived, so "Unarchived only" can legitimately delete 0 when a device's records are all already compressed — use "Everything" to purge those.) Both run in the background and the page shows a live progress banner (start time/elapsed, % complete, deleted/total, ETA) polled from `GET /nas/:id/flows/deletion-status`, mirroring the Archives compression banner.
- Search Flows: filter by Src/Dst IP, NAT IPs, date, NAS, and start/end time-of-day; export results as text or Excel.
- Archives: list of compressed per-NAS 2h batches (with NAS name/IP column) showing record counts and compression ratios, plus a live progress banner during a run (current file/window, elapsed, estimated remaining, % complete, files done) polled from `GET /archives/compress/status`. Rows support checkbox select / select-all + bulk delete, per-row delete, and per-row download of the gzip file (`GET /archives/:id/download`, authed via Bearer token).
- Users & user types; Notifications including "no records generating" alerts.
- Authentication: username/password login, PG-backed sessions (8h), and logout. The whole UI is gated behind login; a default admin is bootstrapped on first run if no users exist. Auth works via either the session cookie OR an `Authorization: Bearer <token>` token (the signed session id, returned by login and stored in `localStorage`), so login works even inside the cross-site Replit preview iframe where browsers block third-party cookies.
- System Log: audit trail of logins (incl. failed attempts), logouts, and user/NAS create-update-delete plus flow exports. Paginated 50/page (server-side via `page`/`pageSize` on `GET /audit-logs`, which returns a `{items,total,page,pageSize}` envelope).
- Archive Logs (nav item between System Log & Notifications): compression/archive activity and errors (events `compression.trigger/.window/.complete/.error`, `archive.delete`; levels info/warning/error). Paginated 50/page via `GET /archive-logs` (`{items,total,page,pageSize}` envelope, `pageSize` capped at 50, optional `level` filter).
- After login the UI always lands on the Dashboard (login resets the browser path to `BASE_URL` before the auth-gated router mounts).

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
