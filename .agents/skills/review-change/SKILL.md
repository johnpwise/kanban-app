---
name: review-change
description: Review a completed diff through diff-classified lenses — correctness always, plus accessibility, composition, state ownership, API contracts, persistence, error/observability, and route boundary only when the diff touches that concern. Use inline as the review step of a delivery slice, before commit. Replaces the retired per-stack reviewer and guardian agents.
---

# Review Change

Apply this skill **inline** as the review step of a delivery slice — it is procedure the Delivery
Engineer runs in the primary context over its own diff, not a separate agent. Delegate the whole
review to `independent-reviewer` only when the Delegation Gate in `reasoning-selection-policy.md`
is met — typically a completed change on a security, authorization, data-boundary, or cross-feature
shared-state path where an isolated second opinion on the finished diff materially raises confidence.

## How to run it

1. **Classify the diff.** Decide which concerns it actually touches. Record the classification and,
   for every lens you skip, a one-line reason.
2. **Run the correctness lens always** — `references/correctness.md` for the stack you are in
   (frontend or backend framing). It is never skipped, however small the change.
3. **Run each conditional lens whose trigger the diff hits** (table below). Each lens has a
   reference file with what to check and what to flag.
4. **Fold findings into the Step Record**, split into blocking (`changes-required`) and
   non-blocking (follow-up). A blocking finding routes scoped rework inline via `tdd-slice`, then
   the lenses the rework touched re-run. Never wave a blocking finding through; never let rework
   skip the lens that found the problem.
5. The closeout Step Record lists which lenses ran and why each skipped one was skipped
   (Artifact budget: independent review 600 words; an inline review is smaller).

## Lens triggers

| Lens | Reference | Runs when |
| --- | --- | --- |
| correctness | `references/correctness.md` | **Always** — every code change. |
| accessibility | `references/accessibility.md` | The diff changes interactive UI — user-visible markup, focus/keyboard behaviour, dialogs/overlays, forms, or ARIA. Skip for pure logic/util/test-only diffs. |
| composition (React) | `references/react-composition.md` | The diff adds or reshapes components, hooks, context, or a shared abstraction. Skip when no component/hook boundary moves. |
| composition (Vue) | `references/vue-composition.md` | The diff adds or reshapes components, composables, provide/inject, or a shared abstraction. Skip when no component/composable boundary moves. |
| state ownership | `references/state-ownership.md` | Owner choice or `capability_owners.shared_client_state_tier` (`subtree` vs `cross_feature`) is unclear, or state is lifted/shared across features. |
| API contracts | `references/api-contracts.md` | Request/response/error shapes, status-code semantics, nullability, or mapping boundaries change. |
| Next.js server/client boundary | `references/nextjs-boundary.md` | The diff adds or moves a `"use client"` boundary, a Route Handler, a Server Action, or a trust-boundary Zod validation point, or server-only code's reachability from a Client Component changes. |
| persistence | `references/persistence.md` | Repository behaviour, query shapes, multi-entity writes, or transaction guarantees change or are risky. |
| error / observability | `references/error-observability.md` | Error mapping, retries/timeouts/fallbacks, logging quality, metrics, or traces change or are risky. |
| route boundary | `references/route-boundary.md` | Transport, service, and persistence concerns risk being mixed, or boundary ownership is unclear. |

## Reasoning demand

Each lens defaults to `review-routine`. Raise a lens to `review-elevated` (or `deep`) only when
that lens's own reasoning is genuinely hard — a large or multi-finding diff, questionable state
ownership, evident architectural drift, contested test-first evidence, a contract change affecting
other consumers, transaction/concurrency risk, or non-trivial focus/validation flows. Raising a
lens's reasoning demand never by itself moves it out of the primary context.

## Evidence gates (correctness lens, blocking)

Treat missing test-first evidence as a blocking finding:
- no explicit `test_layer_matrix` (`unit`, `component`, `integration`, `e2e`) with a rationale for
  each `N/A`
- no evidence that `required_preimplementation_tests` failed before production code changed
- required `e2e_status` not passing at closeout
- for backend diffs, missing `capability_owners.transport_boundary_owner` /
  `service_boundary_owner` / `persistence_boundary_owner`
- for asserted UI targets, missing `data-id`, or `data-id` values hard-coded in markup instead of
  colocated `*_TEST_IDS` constants
