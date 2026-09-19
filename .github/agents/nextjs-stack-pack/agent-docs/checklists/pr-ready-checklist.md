# pr-ready-checklist.md

Inherit the frontend baseline checklist (Behavior, Type safety, State and architecture, Tests,
Review hygiene, Accessibility / UX) from
`agents-core/agent-docs/checklists/pr-ready-checklist.md`. This file adds the Next.js-specific
extensions and new sections below.

## Behavior — extends the baseline
- the baseline "loading, error, empty, and disabled states" item is satisfied via `loading.tsx` /
  `error.tsx` / `not-found.tsx` route conventions where they have a real purpose, or
  component-level state otherwise

## Type safety — extends the baseline
- TypeScript types at trust boundaries are derived from the Zod schema that validates them, not
  maintained as a separate hand-written interface

## State and architecture — extends the baseline
- the baseline "remote data is not duplicated into client state" item is restated for this stack
  as: server-rendered/server-owned data is not duplicated into a client store or
  `client_remote_state_owner` tool without cause
- the baseline "components are not performing transport concerns directly" item also requires:
  when the data can be read from the server-side service layer
- business/domain logic is not embedded in `page.tsx`, `layout.tsx`, a Route Handler, or a Server
  Action
- `"use client"` boundaries are as small as practical; a whole page/subtree was not converted for
  one interactive control

## Trust boundary (new section, no baseline equivalent)
- every new/changed HTTP body, Server Action input, `FormData`, query/route param, webhook
  payload, or external-API payload is validated with Zod before domain logic uses it
- validation failures return a safe, predictable result without leaking internal details
- every Route Handler and Server Action performing protected behavior independently enforces
  authorization on the server (not just client-side UI hiding)

## Tests — extends the baseline
- `async` Server Component / route-rendering behavior is proven via Playwright, not forced into a
  Vitest component test

## Review hygiene — extends the baseline
- the baseline "every diff-triggered lens ... is complete" item also includes the `nextjs-boundary`
  lens (accessibility, composition, state-ownership, contract, nextjs-boundary)

## Accessibility / UX — extends the baseline
- the baseline "focus behavior is acceptable for the flow" item also covers: after a client-side
  route transition

## Caching / revalidation (new section, no baseline equivalent)
- static vs dynamic vs request-time data has an explicit, deliberate choice, not an accidental
  default
- any explicit caching (`use cache`, `cacheLife`, `cacheTag`) has a stated invalidation/revalidation
  path
- no user-specific or authorization-sensitive data is accidentally cached across users
