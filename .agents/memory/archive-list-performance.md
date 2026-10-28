---
name: Archive list performance
description: Why archive-list queries must exclude compressed contents before data reaches the API.
---

Archive lists must select only metadata at the SQL level, never read all columns and discard the payload during serialization.

**Why:** A self-hosted server had archive metadata present but its list repeatedly exceeded Nginx's 60-second timeout. A later request still took tens of seconds. Even a small number of archive rows can represent millions of flows and hold large base64-compressed payloads. Counting archive rows was fast; fetching all columns needlessly transferred the payloads into API memory. The old UI rendered request failure as blank rows, making the archives appear missing.

**How to apply:** Keep compressed content on the download path only. Preserve visible request-error states separately from successful empty lists. Do not treat a blank archive table or zero original-flow count as proof that archive data has been lost, and do not increase proxy timeouts instead of removing unnecessary payload reads.
