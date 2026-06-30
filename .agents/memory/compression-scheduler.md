---
name: Periodic job scheduling on restart-prone hosts
description: Why the compression job uses a short gated poll instead of one long setInterval
---

# Periodic compression scheduling

Schedule recurring background work (e.g. the archive-compression job) as a
**short-cadence poll gated by a cheap pre-check**, plus a startup kick — NOT a
single long `setInterval`.

**Why:** a single `setInterval(fn, 2h)` first fires only 2h after process start
and the timer resets on every restart. On a systemd/self-hosted box that
restarts on each deploy, the long timer keeps getting cut short before it ever
fires, so the job effectively never runs automatically (symptom: manual
"Compress Now" works, auto-compress never happens). It's also unaligned to the
fixed IST window boundaries, so even when it does fire it's late.

**How to apply:** poll every ~15 min and gate the actual run behind an indexed
readiness check (`hasCompressibleBacklog` mirrors `compressBacklog`'s
earliest-unarchived + window-grace test; backed by
`flow_records_archived_end_idx`). The check must faithfully match the worker's
readiness test or it drifts (skips ready work / fires no-ops that flash the UI
banner). Also fire one check ~60s after startup so a restart doesn't delay
archiving by a whole interval. `runCompression`'s `compressionRunning` flag
already serializes overlapping startup-kick vs interval invocations.
