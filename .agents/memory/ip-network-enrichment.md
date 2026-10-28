---
name: ISP and network-owner enrichment
description: Privacy, meaning and performance constraints for Top Talkers ISP labels
---

ISP labels represent the public IP's network organization/ASN, not an individual subscriber. Classify private, documentation, scoped and other non-public addresses locally; never send those addresses for external lookup or invent an ISP for them.

**Why:** The user requested ISP names below Top Talkers IPs, while the Replit-only sample addresses are documentation addresses without real ISP owners.

**How to apply:** Keep sample labels truthful and show an explicit unavailable/not-found state when a public lookup fails.

Enrichment must not block traffic statistics or repeatedly rerun flow aggregates while waiting for provider responses. Cache successes and failures separately from raw flow data, with bounded memory and concurrency.

**Why:** Dashboard aggregates already operate on growing traffic history; external lookup latency or provider outages must not make the collector and dashboard slower.

**How to apply:** Poll lightweight enrichment metadata only while lookups are pending, not the Top Talkers aggregation. Preserve traffic results even when enrichment is unavailable.
