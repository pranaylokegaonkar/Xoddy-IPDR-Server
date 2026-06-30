---
name: Drizzle inArray at production scale
description: A large id list passed to Drizzle's inArray crashes the SQL builder and exceeds Postgres's param limit; how to bulk-update/delete safely.
---

# Drizzle `inArray` on huge id lists is a production-scale landmine

Passing tens/hundreds of thousands of ids to `inArray(column, ids)` fails two ways at scale:
- **`RangeError: Maximum call stack size exceeded`** in drizzle-orm `mergeQueries` / `buildQueryFromSourceParams` — the builder recurses per parameter.
- **Postgres 65535-parameter-per-statement limit** — even if the builder survived, the protocol rejects it.

Both are invisible in dev (a few thousand rows) and only detonate on a live collector with hundreds of thousands of rows. Symptom seen: compression gzipped a 223k-row window fine, then the `inArray(id, archivedIds)` mark-archived UPDATE threw the RangeError, rolling back the whole transaction so **no archive ever persisted** (rows stayed `archived=0`).

## How to fix, depending on whether the exact set matters

**Bulk DELETE (set membership doesn't need to be frozen):** use a subquery, not an id list:
`db.delete(t).where(inArray(t.id, db.select({id:t.id}).from(t).where(...).limit(BATCH)))`, loop until `result.rowCount === 0`. No id list materialized; one statement per batch; `rowCount` drives progress. A start-of-run `id <= cutoffId` snapshot still guarantees termination under concurrent inserts.

**Mark/UPDATE an EXACT frozen set (e.g. the rows just gzipped into an archive):** you must touch the precise ids you read, in **bounded chunks** (e.g. 1000/statement) within the same transaction.

**Why not a predicate like `archived=0 AND end_time in window AND id<=maxId`?** It looks equivalent and is O(1) statements, but it is NOT exact under READ COMMITTED: a late row can draw a *lower* serial id before your SELECT yet commit *between* your SELECT and the UPDATE, so the predicate flags it `archived` even though it was never in the gzip payload — silently dropping a record. For an IPDR/compliance system that must never drop records, chunk the explicit read ids instead. (Architect-confirmed.)

**How to apply:** any new bulk update/delete over `flow_records` (or any continuously-written table) must avoid a giant `inArray` id list — subquery for deletes, chunked explicit ids for exact-set updates. Never `Math.max(...bigArray)` either; it stack-overflows on large arrays — use a loop.
