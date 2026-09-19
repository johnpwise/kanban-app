# state-ownership-policy.md

## Purpose

This document adds Next.js-specific guidance on top of the canonical frontend policy in:

- `agents-core/agent-docs/standards/architecture/frontend-state-ownership-standards.md`

Use that core standard as the source of truth for the shared decision ladder and tier qualifier semantics.

## Why this stack extends the ladder

The core ladder was written for client-side state in a framework-neutral way, and its
`server_state_owner` key assumes "remote data fetched from the browser." Next.js is a full-stack
framework: most remote/persisted data in this stack is read **on the server**, by a Server Component
or a server-side service, and never needs client-side lifecycle handling at all. Collapsing that into
a single `server_state_owner` key would blur two very different ownership decisions, so this stack
splits it into two keys:

- `capability_owners.server_data_owner` — data owned and rendered on the server. This is the default
  for remote/persisted data in this stack.
- `capability_owners.client_remote_state_owner` — data genuinely owned by client-side tooling (for
  example TanStack Query), used only when the data must live and refresh in the browser.

## Next.js-specific mapping

When applying `capability_owners.shared_client_state_owner`, always include:

- `capability_owners.shared_client_state_tier: subtree | cross_feature`

Next.js-specific expectations:

- `subtree`: prefer React Context or lifted tree state when ownership naturally spans one feature subtree
- `cross_feature`: use broader store-based client state (for example Zustand) only for durable cross-page or cross-feature concerns

For remote/persisted data, ask in order:

1. **Does this data only need to exist on the server to render a page or segment?**
   → `capability_owners.server_data_owner`. Read it in a Server Component or a server-side
   service/data-access module. This is the default; most data in this stack stops here.
2. **Does the browser need this data outside of an initial server render** — genuinely client-driven
   polling, optimistic updates the user triggers repeatedly, or long-lived client-side query state
   that outlives a single navigation?
   → `capability_owners.client_remote_state_owner` (for example TanStack Query), and state the
   concrete reason. Do not reach for this merely because a component "needs some data" — a Server
   Component parent can usually fetch it and pass it down, or a Server Action can refresh it.
3. **Does this remote data need a first-party HTTP endpoint** (a browser fetch from a Client
   Component, a webhook, a public/partner API)?
   → `capability_owners.http_boundary_owner` (a Route Handler). This is orthogonal to 1/2: a Route
   Handler can exist to serve external callers even when the same data is otherwise read via
   `server_data_owner` inside the app.
4. **Does the frontend need to write/mutate server-owned data?**
   → `capability_owners.mutation_boundary_owner` (a Server Action), following the same trust-boundary
   discipline as a Route Handler.

## Rules of thumb

Prefer local state when possible because:
- ownership is obvious
- testing is simpler
- coordination cost stays low

Prefer `server_data_owner` over `client_remote_state_owner` because:
- it avoids an unnecessary client-server round trip for data the server can render directly
- it avoids duplicating server truth into a client cache that can drift
- it needs no client-side loading/error state machinery for the initial render

Avoid:
- multiple writable sources of truth
- copying fetched server data into client stores or `client_remote_state_owner` tooling by habit
- globalizing modal, filter, or form state prematurely
- storing simple derivations that can drift from source data
- reaching for a Route Handler to serve data to a Server Component in the same application when the
  service/data-access layer can be called directly

Concrete package choices for these ownership capabilities belong in the repo-local overlay.
