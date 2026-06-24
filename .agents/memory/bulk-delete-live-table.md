---
name: Bulk delete on a live-ingest table
description: Why background bulk deletes on continuously-written tables must snapshot a cutoff at start.
---

A background bulk delete that loops `select a page of matching ids → delete them → repeat`
over a table that is **still being written** (e.g. the NetFlow collector inserting into
`flow_records`) must capture a snapshot boundary at start and constrain every batch to it.

**Rule:** capture the current max `id` (serial, monotonic) for the target set at job start, then
only ever delete `id <= cutoff AND <predicate>`. Use the same cutoff in the count and in every
batch select.

**Why:** without the cutoff the loop keeps picking up rows inserted *after* the job started, so it
(a) may never terminate under sustained ingest, and (b) silently destroys live records the operator
never asked to delete — a direct violation of the IPDR "never drop/lose records" principle. This was
flagged in code review of the NAS "delete unarchived flow data" feature and is the reason the delete
is bounded by an id cutoff rather than a naive `while rows remain` loop.

**How to apply:** any future "purge by filter" / bulk-delete background job on `flow_records` (or any
other collector-written table) must snapshot a cutoff the same way. Also make the start function
report whether it actually started (vs. a no-op because one is already running) so audit logs and the
API response don't claim a job began when it didn't.
