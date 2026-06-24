---
name: Flow archive compression
description: Atomicity rule for the 2-hourly flow compression job
---

The compression job selects eligible flow rows, gzips them into archive rows,
and marks those rows `archived`. Do all three in ONE transaction over a frozen
set of row IDs (capture ids from the SELECT, mark with `inArray(ids)`).

Each 2h IST window is split into ONE archive file PER NAS (grouped by `nasId`):
filename `<SanitizedNasName>_<ip>_<YYYY-MM-DD>_<HHMM>IST.json.gz`. All per-NAS
files for a window plus the single `archived` UPDATE still commit in that window's
one transaction, so payload↔archived-row consistency holds across every file.
`flow_archives` carries nullable `nasId/nasName/nasIp` (null on pre-split rows,
shown as "All" in the UI). `progress.completedCount += windowResults.length`
(counts per-NAS files, not windows).

**Why:** Re-running the same WHERE clause for the UPDATE can mark rows that became
eligible after the SELECT — they get flagged archived but were never in the gzip
payload, so they are lost. Persist the payload (base64 in `flow_archives.payload`)
or archives are not durable/retrievable.

**How to apply:** Never use a time-window predicate for the archive UPDATE; always
update by the exact ids included in the payload.
