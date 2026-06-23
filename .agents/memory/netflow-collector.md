---
name: NetFlow collector design
description: How the Xoddy IPDR collector parses NetFlow/IPFIX and assigns timestamps
---

NetFlow v9 and IPFIX are template-based: data records cannot be decoded until the
exporter sends the matching template. Cache templates keyed by
`exporterIp:observationDomainId:templateId`. The cache is in-memory, so it resets
on restart and routers must re-send templates (MikroTik does on its refresh timer).

**Why:** A fixed-offset parse only works for v1/v5. Returning `[]` for v9/IPFIX
silently drops the formats most modern routers actually export.

**How to apply:** When touching `collector.ts`, keep per-exporter template state.
Flow start/end times must derive from exporter data (v1/v5: header
unix_secs/sysUptime + record first/last; v9: FIRST/LAST_SWITCHED vs boot time;
IPFIX: flowStart/End ms or s), never `Date.now()` — search/export by time depends on it.
