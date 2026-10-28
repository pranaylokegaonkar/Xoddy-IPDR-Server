---
name: Historical archive search
description: User-requested separation between existing flow searches and temporary searches of archived data
---

Keep the existing flow-table search under **Current Day Search**. **Old Search** searches isolated temporary copies of explicitly selected archives. Never restore historical records into the live flow table merely to search them.

**Why:** The user needs historical searches after original-flow retention cleanup, without permanently rebuilding the large live table or slowing collection.

**How to apply:** Preserve ordinary flow search behaviour. Temporary-workspace release and expiry remove only temporary data, never the original archives. Selected archives must remain protected against deletion for the workspace's lifetime.

Put **Current Day Search** and **Old Search** underneath **Search Flows** in the navigation panel, not in page-header tabs.

**Why:** The user explicitly requested this navigation placement.

**How to apply:** Keep both modes accessible from navigation when revising the search screens.

Keep **Clear Search** separate from releasing an active temporary workspace.

**Why:** Resetting filters should not discard prepared historical data or remove its archive-deletion protection.

**How to apply:** Clear filter inputs, results, errors and pagination without releasing the workspace; keep release as a separate confirmed action.

Use flow **end time** for the archive-selection window and its exact timestamp boundaries, with IST displayed explicitly.

**Why:** Archives are bucketed by end time; using start time to select archive windows can omit the required files.

**How to apply:** Keep archive-window selection separate from the additional Filter Criteria used inside a prepared workspace. Do not treat a browser export request as proof that a file was saved; confirm release from workspace status.
