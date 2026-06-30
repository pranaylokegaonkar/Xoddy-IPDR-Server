---
name: orval generated hooks require explicit queryKey when passing query options
description: In this repo's orval react-query setup, a generated useGetX hook's query options object must include queryKey or it fails typecheck with TS2741.
---

When you pass a `query` options object as the 2nd arg to a generated `useGetX(params, { query: {...} })` hook (e.g. to add `placeholderData: keepPreviousData` for paginated lists), you MUST also supply `queryKey` inside it — orval does not auto-merge the default key once you provide your own `query` object. Use the generated `getGetXQueryKey(params)` helper.

**Why:** the generated `UseQueryOptions` type requires `queryKey`; omitting it surfaces as `error TS2741: Property 'queryKey' is missing`. The existing `useGetCurrentUser` call in `App.tsx` already follows this pattern.
**How to apply:** any time you add `query: { ... }` options to a generated list/detail hook, pass `queryKey: getGetXQueryKey(params)` alongside your other options.
