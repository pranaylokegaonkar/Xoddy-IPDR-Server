---
name: Orval path+query param collision (TS2308)
description: Why an endpoint must not mix a path param and a query param in this repo's OpenAPI spec.
---

# Orval path + query param collision

When a single OpenAPI operation has BOTH a path parameter AND a query parameter, orval codegen emits a TS2308 duplicate-export error from `lib/api-zod/src/index.ts` (which does `export *` from both `./generated/api` and `./generated/types`). The zod client generates a path-params **const** `<Op>Params` in `api.ts`, while the types output generates a query-params **type** `<Op>Params` in `generated/types/` — same name, value vs type, and `export *` across two modules does not merge them.

- Query-param-only endpoints are fine (zod names them `<Op>QueryParams`, type is `<Op>Params` — no clash).
- Path-param-only endpoints are fine (no `*Params` type file is generated at all).

**Why:** discovered adding a `scope` query param to `DELETE /nas/{id}/flows` (which already had the `{id}` path param). Codegen broke with `error TS2308: ... already exported a member named 'DeleteNasFlowsParams'`.

**How to apply:** to add an option/variant to a path-param endpoint, use a dedicated path-only sub-route (e.g. `DELETE /nas/{id}/flows/all`) or a request body — never a query param on a path-param operation. Share the backend logic between the two routes with a helper.
