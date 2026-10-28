---
name: Data Archive uploads
description: Import restrictions, retention safety and binary-request caveat
---

The user requested Data Archives uploads in the same archive storage, restricted to `.json.gz`. Preserve the existing database/Windows-share storage policy; uploads must not restore records into live flows or overwrite existing archives.

**Why:** The user asked for upload "at same location" with ".json.gz restricted", not a new storage service or live-data restoration.

**How to apply:** Validate the actual gzip contents and flow-array format, not just the extension. Keep historical search operating on temporary copies.

Imported archives must never qualify original flow rows for retention deletion, even when their dates and record counts resemble automatic archives.

**Why:** Imported files have not participated in the atomic archive-and-mark transaction. Their metadata cannot prove which live rows they contain.

**How to apply:** Keep the explicit import marker, set it on every upload and exclude imports from both retention window aggregation and durability-evidence selection.

Do not assume a generated Blob parameter sends raw file bytes.

**Why:** The current Orval fetch generator serializes the gzip Blob as JSON despite the binary OpenAPI schema.

**How to apply:** Keep the verified raw-file sender or fix the generator before adopting its upload function. Verify received gzip bytes through the HTTP router; TypeScript checks alone do not catch this mismatch.
