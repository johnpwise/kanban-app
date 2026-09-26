# bug-workflow-routing.md

## Purpose

This document defines Next.js-specific bug workflow routing deltas that overlay `agents-core` bug workflow routing.

Inherit baseline ownership, routing metadata semantics, artifact persistence/index/bootstrap/cleanup behavior, intake/classification flow, and mandatory gate rules from:

- `agents-core/agent-docs/workflows/bug-workflow-routing.md`

## Stack-specific review gates (diff-classified)

Generate `review-lens-manifest.json` from the completed diff and canonical slice spec, then load
only its `loadReferences` and apply those lenses inline via `skills/review-change/`. Every lens is
`delegation: inline` unless the Delegation Gate is separately met.

| Lens (`skills/review-change/references/`) | When it runs |
| --- | --- |
| `correctness.md` | **Always.** Every code change. |
| `accessibility.md` | When the fix changes interactive UI — user-visible markup, focus/keyboard behavior, dialogs/overlays, forms, or ARIA. Skip for pure logic/util/test-only fixes. |
| `react-composition.md` | When the fix adds or reshapes components, hooks, context, or a shared abstraction. Skip when no component/hook boundary moves. |
| `state-ownership.md` | When owner choice or `capability_owners.shared_client_state_tier` (`subtree` vs `cross_feature`) is unclear, or state is lifted/shared across features, or the choice between `server_data_owner` and `client_remote_state_owner` is unclear. |
| `api-contracts.md` | When request/response/error shapes, Zod schemas, nullability, or mapping boundaries change (Route Handlers, Server Actions, or external integrations). |
| `nextjs-boundary.md` | When a `"use client"` boundary is added or widened, a Route Handler or Server Action is added or changed, server-only code moves relative to a Client Component, or a trust-boundary validation point is added or moved. |
| `architecture-advisor` | When ownership, layering, public contracts, or module boundaries change or are unclear — including whether behavior belongs in a Server Component, Client Component, Server Action, Route Handler, or a separate backend service. |
| `skills/dependency-assessment/` | New dependencies or material dependency/tooling/runtime changes (inline; escalate unusual ones to the user). |

Contract modelling happens at plan time (`skills/feature-planning/`); the api-contracts lens then reviews the change in the diff.

The closeout step record links the manifest path/hash and retains each skipped lens's machine
reason code. Uncertain classification includes the lens; model judgment may add but never remove.

## Required gate reminder

- The correctness lens plus every manifest-included lens above must be complete with no blocking findings before PR-ready closeout.
- Commit authoring must run only after the applicable review lenses pass with no blocking findings.
- Commit authoring is complete only after push succeeds and push evidence is recorded.
- `ready-for-closeout` is valid once commit authoring completes with commit SHA(s) and push-success evidence; PR authoring is never required for closeout.
- PR authoring must run only on an explicit, separate PR request, and only after commit authoring is complete and commit SHAs are recorded; it must never be dispatched automatically after commit-and-push.
- When explicitly requested, PR authoring is complete only after live PR creation succeeds and PR URL/number evidence is recorded.
- If push fails, workflow must route `blocked` or `awaiting-approval` (never `ready-for-closeout`). If an explicitly requested PR creation fails, route that request `blocked` or `awaiting-approval` without reopening an already closeout-ready workflow.
- Closeout is incomplete until `.agent-workflows/<workflow_id>/` is deleted and cleanup status is confirmed.
