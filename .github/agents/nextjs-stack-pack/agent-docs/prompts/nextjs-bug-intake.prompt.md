# nextjs-bug-intake.prompt.md

Use this when the core prompt/orchestration agent needs a Next.js-aware bug-intake pass before dispatching work.

First, read and follow `agents-core/agent-docs/prompts/bug-intake-baseline.prompt.md` in this
repository (shared intake policy, trigger template, Early routing hints framing, and the
"Frontend stacks" Capture / Early routing hints / Intake output shape sections). This file adds
the Next.js-specific delta below.

## Intake policy — extends the baseline
- If the bug is a server/client boundary problem (hydration mismatch, a Server Action or Route Handler missing authorization, leaked server-only data), identify it explicitly rather than papering over it in a Client Component.

## Capture — Next.js delta (replaces the baseline's generic screens/states/server_state_owner items)
- affected routes/segments (`app/**`), feature areas, and likely modules
- expected loading, error, empty, disabled, and recovery states, and whether `loading.tsx` /
  `error.tsx` / `not-found.tsx` conventions are involved
- `capability_owners.server_data_owner` candidate
- `capability_owners.client_remote_state_owner` candidate (only if genuinely client-owned remote state is involved)
- remote data/contracts involved and suspected API boundaries (Route Handler, Server Action, or third-party integration), and whether a Zod schema is missing, wrong, or too permissive
- whether the defect is a caching/revalidation problem (stale data after mutation, accidental cross-user caching of authorization-sensitive data)
- the baseline's `test_layer_matrix` item also notes that `async` Server Component rendering is proven at `e2e`, not `component`

## Early routing hints — extends the baseline
- server/client boundary placement when the defect is a misplaced `"use client"`, a Route
  Handler/Server Action missing validation or authorization, or server-only code reachable from a
  Client Component

## Intake output shape — Next.js delta (replaces the baseline's generic server_state_owner item)
- `capability_owners.server_data_owner`
- `capability_owners.client_remote_state_owner` (only if genuinely used)
- the baseline's "likely contract surface" item also includes: the trust-boundary Zod schema(s) involved
