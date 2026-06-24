---
name: Archive 2-hour windowing
description: How/why flow archives are bucketed into fixed IST 2-hour clock windows, and the deliberate no-uniqueness tradeoff.
---

Flow archiving groups unarchived records into fixed 2-hour windows aligned to the
**IST (UTC+5:30) wall clock** (00:00–02:00, 02:00–04:00, … IST), one archive row
per fully-elapsed window — not the old rolling "older than 2h" single blob.

- Records are bucketed by the window their **`end_time`** falls into (end, not
  start: guarantees the flow fully completed before the window is archived).
- Windows are **half-open `[start, end)`** — a flow ending exactly on a boundary
  belongs to the *next* window.
- A just-closed window is **deferred by a 15-min grace** before archiving, so
  late-trailing NetFlow exports (active/inactive timeout lag) land in the right
  batch instead of triggering a second archive for the same window.

**Why no DB unique constraint on the window (periodStart/periodEnd):**
A unique constraint would make a late record's insert conflict and roll back the
transaction → the record would be dropped. For an IPDR/compliance system, never
drop records. So a late arrival after its window was already archived produces a
second, harmless archive instead. Archives are identified by `id`, so a duplicate
filename/window is cosmetic only.

**How to apply:** if asked to "dedupe" archive windows or add uniqueness, push
back — the duplicate is the safe behavior. If the windows must follow a different
timezone, change `IST_OFFSET_MS` in `artifacts/api-server/src/lib/jobs.ts`.

**Compression must scale to a huge first-time backlog; never compress it all in
one request or one transaction.** This is self-hosted behind nginx (60s proxy
timeout), and a collector that has never archived can have millions of unarchived
rows. Three rules keep it safe — keep all three:
- **Bound memory & lock time:** archive one window at a time (oldest-first), each
  in its own transaction. Never select/serialize the whole backlog at once
  (caused both an nginx 504 and OOM risk).
- **Manual trigger is fire-and-forget:** the "compress now" endpoint must respond
  immediately (after a cheap readiness check) and run the work in the background,
  not block the HTTP request — the backlog can outlast any proxy timeout.
- **Serialize runs in-process:** guard so a double-click or an overlap with the
  scheduled job can't launch two concurrent backlog passes (duplicate work).
- **Index the compression access path:** `flow_records` needs a composite index
  on `(archived, end_time)`. The table was only indexed on its search dimensions
  (nas, date, src/dst ip), so the "earliest unarchived record" and per-window
  selects full-scanned it — on a large backlog that alone can blow the proxy
  timeout, even after the work is backgrounded.
**Why:** the originally-reported failure was a 504 from clicking "compress now"
against a large backlog.

**Live progress:** the run exposes in-memory status (current window/file, ETA, %)
via a status endpoint the UI polls. Progress is measured by how far through the
backlog's *time span* (earliest unarchived end_time → current window start) the run
has advanced, NOT by window count — so instantly-skipped empty windows still move
the bar and the ETA stays meaningful with sparse data. State is process-local
(matches the in-process run lock); a multi-instance deploy would need shared state.

**Deploy reminder:** a 504 on "compress now" against the live server after a fix
almost always means the API server code wasn't actually rebuilt+restarted (the
new path returns 202 instantly, never 504). Schema/index changes also require a
`drizzle-kit push` against the *real* live DB, not just a code redeploy.
