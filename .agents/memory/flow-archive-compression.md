---
name: Flow archive compression
description: Atomicity rule for the 2-hourly flow compression job
---

The compression job selects eligible flow rows, gzips them into an archive row,
and marks those rows `archived`. Do all three in ONE transaction over a frozen
set of row IDs (capture ids from the SELECT, mark with `inArray(ids)`).

**Why:** Re-running the same WHERE clause for the UPDATE can mark rows that became
eligible after the SELECT — they get flagged archived but were never in the gzip
payload, so they are lost. Persist the payload (base64 in `flow_archives.payload`)
or archives are not durable/retrievable.

**How to apply:** Never use a time-window predicate for the archive UPDATE; always
update by the exact ids included in the payload.
