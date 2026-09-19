# model-routing-policy.md

## Purpose

This document defines execution-profile routing guidance for the Next.js stack pack. Inherit the
frontend baseline (reasoning-demand tiers, Global Routing Rules, review lens defaults, the
api-contracts lens, and Escalation Criteria) from
`agents-core/agent-docs/routing/model-routing-policy.md`; this file adds only the Next.js-specific
delta below.

Use `delegation: independent` only when an isolated second opinion on a completed diff materially
raises confidence (for example an authorization, data-boundary, or Server Action/Route Handler
change).

---

## Next.js-specific additions

Global Routing Rules — also use **`elevated`** reasoning demand when:
- component boundaries or hook extraction are debatable
- state ownership is unclear, including whether data belongs to `server_data_owner` or
  `client_remote_state_owner` (extends the baseline "state ownership is unclear" criterion)
- whether behavior belongs in a Server Component, Client Component, Server Action, or Route
  Handler is unclear
- the API contract, Zod schema shape, or nullability is unclear (extends the baseline "API
  contract or nullability is unclear" criterion)
- caching/revalidation ownership for a piece of data is unclear

Review lens defaults — also apply:
- The baseline **state-ownership lens** also starts at `review-elevated` when the
  `server_data_owner` vs `client_remote_state_owner` choice is unclear.
- **composition lens** — a new shared abstraction is proposed, component/hook boundaries affect
  multiple features, or tree-wide prop/context changes are being considered.
- **nextjs-boundary lens** (`skills/review-change/references/nextjs-boundary.md`) — start at
  `review-elevated` when a Route Handler or Server Action gains new authorization responsibility, a
  `"use client"` boundary is widened rather than narrowed, or a trust-boundary Zod schema is
  loosened; drop to `review-routine` for a narrow, additive Route Handler/Server Action or an
  unambiguous Server-Component-only change.

Escalation Criteria — also apply:
- **A Route Handler or Server Action gains, loses, or changes authorization enforcement** -> raise
  the `nextjs-boundary` lens to `review-elevated` and treat this as a Delegation Gate signal (see
  the baseline's security/authorization/data-boundary escalation criterion).
