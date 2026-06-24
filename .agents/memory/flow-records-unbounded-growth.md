---
name: flow_records unbounded growth & dashboard query cost
description: Why dashboard/list aggregates over flow_records must be time-scoped + indexed, not all-time.
---

Compression marks rows `archived=1` but **never deletes them from `flow_records`** — the full
archived history stays in the hot table, so on a live NetFlow collector `flow_records` grows without
bound.

**Rule:** any dashboard or list aggregate over `flow_records` (`count(*)`, `sum(bytes)`,
`GROUP BY nas_id/src_ip`, etc.) must be time-scoped to a recent window and backed by an index, or it
becomes a full scan that times out behind nginx as data accumulates.

**Why:** symptom seen in production — every data widget stuck on a loading skeleton while the same
code returned instantly on a few thousand dev rows. The discriminator between dev and prod was table
size, not a code bug. Builds + typechecks were clean; the queries were just unindexed full scans on
millions of rows.

**How to apply:** `flow-trend` and `top-talkers` filter `start_time >= now() - interval '24 hours'`,
supported by an index on `start_time`. Do not add all-time full-table aggregate widgets (an all-time
"Top NAS Devices" `GROUP BY nas_id` widget was removed for this reason). The `summary` endpoint's
all-time `count(*)`/`sum(bytes)` is the remaining unscoped scan — if it ever becomes the bottleneck,
either window it or use an approximate count (`pg_class.reltuples`). On a huge prod table, build new
indexes with `CREATE INDEX CONCURRENTLY` so the collector's inserts aren't blocked by the table lock
that a plain drizzle `push` / `CREATE INDEX` takes.
