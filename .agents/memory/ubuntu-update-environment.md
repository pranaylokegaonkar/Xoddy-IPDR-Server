---
name: Ubuntu update environment
description: Why self-hosted updates must follow the running service's database configuration.
---

Use the running systemd service's environment as the authoritative configuration for self-hosted updates; honor explicit overrides but never silently change database targets.

**Why:** An Ubuntu installation had two environment files. The running service used the project-local file, while the updater used a separate system-level file pointing to a nonexistent database. Schema introspection appeared to hang; a bounded connection test revealed PostgreSQL error 3D000. Retrying with the service's environment completed the schema update and service restart successfully.

**How to apply:** Check service environment-file paths and test the updater's actual connection before schema operations. A successful peer-authenticated local PostgreSQL query does not validate the application's connection URL. Never create a new empty database or overwrite environment files to resolve this mismatch.
