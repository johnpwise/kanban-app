# State ownership lens

Runs when owner choice or `capability_owners.shared_client_state_tier` (`subtree` vs
`cross_feature`) is unclear, or state is lifted/shared across features. Decide the smallest correct
owner for new state. Do not invent state layers — prevent the wrong state landing in the wrong
place. Applies to React, Next.js, and Vue; substitute context / provide-inject as the framework requires. In
Next.js, also weigh whether remote data belongs to `server_data_owner` (a Server Component/server-side
service — the default) before considering `client_remote_state_owner` (for example TanStack Query).

## Review order

1. What user-visible behaviour requires state?
2. Is it local to one component?
3. Does it naturally span a subtree?
4. Does it truly need to survive navigation or coordinate across distant features?
5. Is it remote lifecycle/data state that belongs in server-state tooling?
6. Is any of it derived and better computed than stored?

## Decision rules

- **Local component state** when ownership is single-component, the state is UI-only, and lifting
  adds no behavioural value.
- **Context / provide-inject / lifted tree state** when multiple nearby descendants need the same
  client state, ownership is still within one feature subtree, and store adoption would be
  excessive → set `capability_owners.shared_client_state_tier: subtree`.
- **Global / store client state** only when behaviour spans distant routes/pages/features, must
  stay consistent beyond one subtree, and has a clear ownership and lifecycle reason → set
  `capability_owners.shared_client_state_tier: cross_feature`.
- **Server-state handling** when the value originates remotely and caching, invalidation,
  refetching, or request lifecycle matters.
- **Computed** over stored when the value derives cheaply and reliably from existing sources and
  storing it risks drift.

## Smells to flag

- copying fetched data into client stores without a clear need
- a global store used to avoid prop composition
- modal/form state placed globally without cross-page need
- storing filtered/sorted views instead of deriving them
- multiple writable sources of truth for the same behaviour

## Output into the Step Record

Recommended owner + shared-state tier (when shared) + one-sentence why; alternatives considered and
why they are weaker; drift/duplication/coordination risks; practical implementation notes.
