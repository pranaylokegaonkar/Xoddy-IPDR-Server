---
name: Destructive-job uncertainty
description: Safe interpretation of deletion timeouts and lost background progress on Ubuntu.
---

Do not interpret a timed-out deletion request as proof that nothing was deleted,
or a vanished progress indicator as proof that everything completed. Never
automatically repeat destructive work after either event.

**Why:** Ubuntu installations use Nginx, which can stop waiting while application
work continues. Background deletion progress currently follows the existing
single-process job model rather than a durable queue. Restarting that service
can interrupt an operation after some selected archives have already been
removed.

**How to apply:** check current job status and remaining archives before retrying.
Distinguish an interrupted/unknown operation from completion, keep subsequent
work limited to explicitly selected archive IDs, and avoid updates/restarts
while deletion is active. Surviving a process restart requires persisted job
state; a successful page refresh alone does not establish that guarantee.
