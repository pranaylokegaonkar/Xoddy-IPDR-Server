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
