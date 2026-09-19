# error-handling-and-caching-standards.md

## Purpose

This document carries the repository's reliability/error-handling standard forward for Next.js
constructs that a Vite SPA does not have: route-level error/not-found/loading conventions, Server
Action and Route Handler failure contracts, and caching/revalidation ownership.

## Error handling

Use framework-native error handling without putting business decisions directly into error UI files:

- `error.tsx` renders a recoverable error boundary for its route segment; it displays a safe, generic
  message and a retry affordance, and it must not contain business logic — it reports and recovers,
  it does not decide
- `not-found.tsx` renders when `notFound()` is called or a route genuinely does not resolve; do not
  overload it as a generic empty-state component for cases that are not truly "not found"
- `loading.tsx` provides an instant loading UI via Suspense while a segment streams in; a route stuck
  indefinitely in `loading.tsx` is a defect, not acceptable behavior
- a Server Action failure returns a narrowly scoped, safe error result to the calling Client
  Component (see `agent-docs/standards/coding/runtime-validation-standards.md`); it does not throw an
  unhandled exception across the server/client boundary
- a Route Handler failure maps to an appropriate HTTP status and a stable, safe error body
- do not leak stack traces, internal error messages, or implementation details to end users in any of
  the above; log the detail server-side and return a safe summary

Define predictable error-result contracts at each framework boundary (Route Handler, Server Action)
so calling code can branch on a stable shape instead of a raw thrown error.

## Caching and revalidation

Next.js's caching behavior is opt-in: without an explicit caching mechanism, data fetched in a Server
Component or a `fetch` call is not cached, and every request runs fully dynamic. Do not assume
historical Next.js versions' implicit caching behavior — verify the current stable framework
behavior before relying on any caching claim.

Reason explicitly, per piece of data, about:

- **static vs dynamic vs request-time** — is this value safe to compute once and reuse, or does it
  need to reflect the current request (the current user, the current time, a query parameter)?
- **cache ownership** — which module decides whether and how long a value is cached? Keep that
  decision close to the data-access function that produces the value, not scattered across every
  caller.
- **invalidation/revalidation** — if a value is cached, what invalidates it? A mutation via a Server
  Action should trigger the corresponding revalidation (a tag-based invalidation or a stated
  time-based lifetime) so users are not shown stale data indefinitely after they change something.
- **post-mutation freshness** — after a Server Action or Route Handler mutates data, the affected
  read paths must become fresh again (via explicit revalidation), not merely eventually consistent by
  luck.
- **user-specific data** — data scoped to one user or one authorization context must never be cached
  in a way that another user's request could receive it. When in doubt, do not cache it.

Do not introduce caching merely for performance theater. Correctness comes first: an uncached-but-
correct read is always preferable to a cached-but-wrong one. Add caching deliberately, with a stated
reason and a stated invalidation path, and record that reasoning in the review-lens output when the
`nextjs-boundary` lens runs (see `skills/review-change/references/nextjs-boundary.md`).
