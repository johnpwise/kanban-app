# nextjs-server-client-boundary-standards.md

## Purpose

This document is the Next.js-specific architecture standard that the `react-stack-pack` does not
need, because a Vite SPA has no server rendering, Route Handlers, or Server Actions of its own. It
defines where behavior belongs across Server Components, Client Components, Route Handlers, Server
Actions, and service/domain modules, and when an independently deployed backend still earns its
place alongside a Next.js application.

Framework-neutral engineering standards (naming, module responsibility, duplication, testability,
API boundary discipline) are unchanged from `agent-docs/standards/coding/nextjs-file-coding-standards.md`
and `agents-core`; this document adds the mechanism that is unique to Next.js.

## Server Components (default)

Prefer Server Components by default. A Server Component may:

- call server-side services, repositories, and data-access modules directly
- call external APIs and read server-only configuration
- render Client Components as children, passing serializable data as props

Do not make a Server Component call a Route Handler in the same Next.js application merely to reach
internal server data — call the underlying service/data-access function directly. Reaching a Route
Handler over HTTP from inside the same app is an unnecessary round trip; reserve Route Handlers for
callers genuinely outside the render (browsers, webhooks, other services).

Keep data-access and business/domain logic out of `page.tsx` and `layout.tsx` where practical. Pages
and layouts compose application capabilities (services, components); they are not where business
rules live.

## Client Components (`"use client"`)

Use `"use client"` only when a component genuinely needs one of: browser APIs, local interactive
state, effects, event handlers, a client-only library, a Context provider, or a client-state store
(Zustand). Do not add `"use client"` reflexively "to be safe" or because a nearby file has it.

Keep the Client Component boundary as small as practical:

- push `"use client"` down to the smallest leaf that actually needs it, not up to the page or a large
  layout
- a Server Component may render a Client Component as a child; the reverse import (a Client
  Component statically importing a Server Component's server-only module) is not valid and is a
  signal the boundary is in the wrong place
- do not convert a whole page or a large subtree to a Client Component merely because one nested
  control is interactive — extract that control into its own small Client Component instead

## Route Handlers (`app/**/route.ts`)

Use a Route Handler where an actual HTTP boundary is required: browser/API requests from outside the
render, webhooks, callbacks, external/public/partner consumers, or a BFF endpoint another
application calls.

A Route Handler must stay thin. In order:

1. authenticate where required
2. authorize where required — authentication is not authorization; verify the caller may perform
   this specific action on this specific resource, on the server, every time
3. parse the request
4. validate untrusted input with Zod (see `agent-docs/standards/coding/runtime-validation-standards.md`)
5. delegate to service/domain/application code
6. map the result to an HTTP response, without leaking internal error details

Do not build an Express-style controller/service hierarchy inside `route.ts` just because it exposes
an HTTP endpoint — delegate to the same service/domain modules a Server Component would call, and
keep the handler itself limited to the six steps above.

## Server Actions

Use Server Actions for frontend-originated server mutations. Apply the same trust-boundary
discipline as a Route Handler:

1. receive untrusted input (`FormData` or arguments)
2. parse it
3. validate it with Zod
4. authenticate/authorize where required, on the server, independent of what the UI shows
5. delegate to service/domain code
6. return a narrowly scoped result (not an unbounded object graph)

Do not treat a Server Action as an unrestricted generic API endpoint, a substitute for every
query/data-loading path, or a place for significant business logic — that belongs in a service/domain
module the action calls.

## Service/domain/data-access boundaries

Business/domain logic must not be embedded directly in pages, layouts, Client Components, Server
Components, Route Handlers, or Server Actions. Prefer explicit service/domain/application modules for
business behavior, and explicit data-access/repository/integration modules where persistence or
external-system access exists. Framework entry points (`page.tsx`, `layout.tsx`, `route.ts`, a Server
Action file) stay thin and compose these modules.

Do not over-engineer the bootstrap example with unnecessary layers, but keep the structure agents can
extend safely: a page/layout composes; a Route Handler/Server Action validates and delegates; a
service module decides; a data-access module persists/integrates.

## Security and server/client boundary rules

- secrets and server-only environment variables must never be exposed to the browser bundle
- `NEXT_PUBLIC_*` variables are public by definition — use that prefix only intentionally
- server-only modules (secrets, direct data-access, server SDKs) must not be imported into Client
  Components
- authentication is not authorization: verify the caller may perform this specific action, on the
  server, in every Route Handler and Server Action that performs protected behavior
- client-side hiding of UI (disabled buttons, conditional rendering) is never a security boundary —
  the UI may reflect permissions, but server-side enforcement is authoritative
- sensitive errors must not be exposed to the client; map internal failures to a safe, generic result
  before returning
- watch for accidental serialization of sensitive server data into props passed to a Client Component

## Separate-backend policy

Next.js providing UI plus server-side/BFF capability in one application often removes the need for a
separate Express API that exists solely to support that same web frontend. This does **not** mean "a
separate backend is never needed." An independent backend remains the right call when justified by
architecture, for example:

- an independently deployable backend service, or one consumed by multiple applications
- mobile, third-party, or public/partner API consumers
- WebSocket infrastructure the chosen Next.js runtime/deployment does not suit
- long-running processes, worker/queue architectures, or background jobs
- independently scaled services, or existing service/domain and ownership/deployment boundaries that
  are already separate

Selecting `FRONTEND_STACK="nextjs"` in the master bootstrapper never forces creation of a separate
backend, and remains fully compatible with `BACKEND_STACK="node-express"` or
`BACKEND_STACK="node-express-ts"` when the architecture calls for one. A Next.js frontend project may
itself contain Server Components, Server Actions, Route Handlers, server-side services, and
server-side integrations without being reclassified as a separate backend project.

## Caching and revalidation ownership

Next.js's caching model is opt-in: without an explicit caching mechanism, data is fetched fresh.
Reason explicitly about each piece of data rather than assuming historical Next.js caching behavior:

- is this data static (safe to cache broadly), request-time (must be fresh per request), or
  user-specific (must never be shared across users' caches)?
- who owns invalidation when the underlying data changes — a mutation via a Server Action, an
  external webhook, or a time-based policy?
- if caching is used, is there a corresponding revalidation path (a tag-based invalidation after a
  mutation, or a stated time-based lifetime) so users are not shown stale data indefinitely?

See `agent-docs/standards/reliability/error-handling-and-caching-standards.md` for the full caching
and revalidation standard. Do not introduce caching merely for performance theater — correctness
comes first, and caching authorization-sensitive or user-specific data across users is a defect, not
an optimization.
