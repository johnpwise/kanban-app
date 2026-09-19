# nextjs-feature-intake.prompt.md

Use this when the core prompt/orchestration agent needs a Next.js-aware intake pass before dispatching work.

First, read and follow `agents-core/agent-docs/prompts/feature-intake-baseline.prompt.md` in this
repository (shared intake policy, trigger template, Early routing hints framing, and the
"Frontend stacks" Capture / Early routing hints / Intake output shape sections). This file adds
the Next.js-specific delta below.

## Intake policy — extends the baseline
- Decide early whether new/changed data is `capability_owners.server_data_owner` (the default) or genuinely needs `capability_owners.client_remote_state_owner` before implementation starts.
- Decide early whether new behavior belongs in a Server Component, Client Component, Server Action, Route Handler, or a service/domain module — do not default to a Client Component or a Route Handler out of habit.

## Capture — Next.js delta (replaces the baseline's generic screens/states/server_state_owner items)
- affected routes/segments (`app/**`) or feature areas
- expected loading, error, empty, disabled, and success states, and whether `loading.tsx` / `error.tsx` / `not-found.tsx` conventions apply
- `capability_owners.server_data_owner` candidate (default for remote/persisted data)
- `capability_owners.client_remote_state_owner` candidate (only if genuinely client-owned remote state)
- `capability_owners.http_boundary_owner` candidate (only if an actual HTTP boundary is needed)
- `capability_owners.mutation_boundary_owner` candidate (only if a frontend-originated server mutation is needed)
- untrusted input crossing a trust boundary (HTTP body, `FormData`, query/route params, webhook, third-party payload, env/config) and the Zod schema that will validate it
- caching/revalidation ownership for any new server-rendered or cached data
- the baseline's `test_layer_matrix` item also notes that `async` Server Component rendering is proven at `e2e`, not `component`

## Early routing hints — extends the baseline
- the baseline's frontend state-ownership/contract-modelling hint also covers: state location unclear including `server_data_owner` vs `client_remote_state_owner`; contract modelling when transport shapes, Zod schemas, or nullability are unclear
- server/client boundary placement when it is unclear whether behavior belongs in a Server Component, Client Component, Server Action, or Route Handler

## Intake output shape — Next.js delta (replaces the baseline's generic server_state_owner item)
- `capability_owners.server_data_owner`
- `capability_owners.client_remote_state_owner` (only if genuinely used)
- `capability_owners.http_boundary_owner` / `capability_owners.mutation_boundary_owner` (only if a boundary is added)
- the baseline's "likely contract surface" item also includes: the trust-boundary Zod schema(s) involved
