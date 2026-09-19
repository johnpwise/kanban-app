# Next.js Stack Pack - AGENTS.md

This document defines reusable Next.js-stack guidance that can be inherited by Next.js repositories on top of the shared core agent pack.

Repo-local `AGENTS.md` files should add project facts, exceptions, and approval boundaries. They should not repeat stack-wide policy unless the repo intentionally overrides it.

## 1. Scope

This stack pack targets Next.js applications built as a **full-stack React framework**, not merely another SPA build tool, using:

- Next.js (App Router, current stable release line)
- React 19+
- strict TypeScript
- Server Components by default, Client Components only where justified
- Route Handlers and Server Actions as the HTTP/mutation boundary
- Zod runtime validation at every trust boundary
- behavior-first testing across Vitest (unit/component) and Playwright (e2e)
- accessibility-aware delivery

This pack is appropriate for:
- products that need both UI and server-side/BFF capability in one deployable
- admin dashboards and line-of-business tools
- CRUD-heavy UIs backed by Server Components and Server Actions
- content- and SEO-sensitive applications that benefit from server rendering
- feature-oriented frontends that also need thin first-party API endpoints

This pack is **not** a drop-in replacement for the `react-stack-pack` (React + Vite SPA). Use `react`
when the project is a client-only SPA with no first-party server responsibilities; use `nextjs` when
the project benefits from server rendering, Server Actions, or a first-party HTTP/BFF boundary
alongside its UI. See `agent-docs/standards/architecture/nextjs-server-client-boundary-standards.md`
for the full decision model, including when an independently deployed backend remains appropriate
even with Next.js in play.

## 2. Defaults

Unless a repo-local overlay says otherwise, agents should assume:

- Server Components by default; a component is a Client Component only for a justified reason (browser APIs, local interactive state, effects, event handlers, client-only libraries, Context providers, client-state stores)
- strict TypeScript, no `any`
- `"use client"` boundaries stay as small as practical; never convert a whole page/subtree to a Client Component for one interactive control
- Route Handlers (`app/**/route.ts`) are the HTTP boundary; Server Actions are the mutation boundary for frontend-originated writes
- Zod validates every trust boundary (HTTP bodies, Server Action input/`FormData`, query/route params, webhook/third-party payloads, runtime env/config); static types are never a substitute for runtime validation
- business/domain logic lives in service/domain modules, not in `page.tsx`, `layout.tsx`, Route Handlers, Server Actions, or Client Components
- server state separated from client UI state; remote data owned by Server Components/server-side services by default, not mirrored into client stores
- composition over inheritance, minimal diffs, behavior-first tests, semantic HTML first, no speculative abstractions
- inherit core capability ownership and test-first evidence policy from `agents-core`
- follow the canonical frontend state-ownership ladder from `agents-core/agent-docs/standards/architecture/frontend-state-ownership-standards.md`, extended per `agent-docs/standards/architecture/frontend-state-ownership-standards.md` in this pack
- feature workflow entry requires a leading `New Feature` trigger
- bug workflow entry requires a leading `Bug Fix` trigger
- requests using these Next.js-stack triggers run in fail-closed mode until `.agent-workflows/<workflow_id>/index.md` and the first workflow artifact are persisted
- in Next.js-stack fail-closed mode, the first response must report workflow ownership and routing state, not direct implementation
- in Next.js-stack fail-closed mode, if trigger format or routing metadata is incomplete, request a correctly formatted reissue before code changes
- use `agent-docs/workflows/feature-workflow-routing.md` for feature routing and `agent-docs/workflows/bug-workflow-routing.md` for bug-fix routing overlays
- record each step per the core `handoff-template.md` (compact Step Record; full Cross-Context Handoff Package only for a separate agent context)
- default `Return To Agent` is `delivery-engineer.agent.md` unless incoming handoff explicitly overrides it
- keep workflow entry through `delivery-engineer`; one primary context then owns the slice end-to-end (plan/test/implement/verify/review as states)
- emit a completion block (artifact path + continue-workflow line) only for a cross-context dispatch or a workflow-owner reentry state
- continue in the primary context while `workflow_status: in-progress` and `reentry_reason: none`; re-enter the workflow-owner role explicitly for `blocked`, `awaiting-approval`, or `ready-for-closeout`
- review is applied inline via `skills/review-change/`: the correctness lens runs on every code change before closeout; the accessibility lens runs only when the diff changes interactive UI; the composition lens (`react-composition.md` — Next.js components are React components) runs only when component/hook boundaries move; the state-ownership lens runs when owner/tier choice is unclear; the Next.js boundary lens (`nextjs-boundary.md`) runs when a `"use client"` boundary, Route Handler, Server Action, or trust-boundary validation point is added or moved
- delegate the review to `Independent-Reviewer` only when the Delegation Gate is met (e.g. an auth / data-boundary / cross-feature shared-state change)
- a blocking review-lens finding routes scoped rework inline, then the affected lenses re-run
- after the applicable review lenses pass with no blockers, the Delivery Engineer commits + pushes via the `commit-and-push` skill and records commit SHA(s) + push evidence (remote + branch/ref)
- `ready-for-closeout` is valid once commit-and-push returns with commit SHA(s) and push-success evidence; PR creation is never required for closeout
- a PR is opened only on an explicit, separate PR request recognised per the shared trigger-recognition standard in `agents-core/AGENTS.md`, via the `create-develop-pr` skill; never automatic after commit-and-push, and its output must be a live PR URL/number (artifact-only PR output is non-compliant); if creation fails, route that PR request `blocked` or `awaiting-approval` without reopening an already closeout-ready workflow

## 3. State and data model

Inherit the canonical decision ladder from `agents-core/agent-docs/standards/architecture/frontend-state-ownership-standards.md`.
This stack extends that ladder with two Next.js-specific ownership keys the ladder does not need for
a pure SPA, because Next.js actually renders on the server: `server_data_owner` and
`client_remote_state_owner` (see `agent-docs/standards/architecture/frontend-state-ownership-standards.md`
in this pack for the full rationale). Apply these Next.js-specific mappings when setting frontend
capability ownership:

1. `capability_owners.local_ui_state_owner`: local component state for component-local UI concerns (open/closed, local form UI state, local toggles)
2. `capability_owners.shared_client_state_owner` with `capability_owners.shared_client_state_tier: subtree`: React Context/lifted state when ownership naturally spans a subtree
3. `capability_owners.shared_client_state_owner` with `capability_owners.shared_client_state_tier: cross_feature`: Zustand (or an equivalent durable client store) only for durable cross-page/cross-feature client concerns
4. `capability_owners.server_data_owner`: Server Components, server-side services, and data-access modules for server-rendered/server-owned data — the default for remote/persisted data in this stack
5. `capability_owners.client_remote_state_owner`: dedicated client-side server-state tooling (for example TanStack Query), used only when the data is genuinely client-owned (client-only remote data, browser-driven polling, optimistic client interactions, long-lived client-side query state) — not the default
6. `capability_owners.http_boundary_owner`: Route Handlers (`app/**/route.ts`) for actual HTTP endpoints (browser/API requests, webhooks, callbacks, BFF/public/partner endpoints)
7. `capability_owners.mutation_boundary_owner`: Server Actions for frontend-originated server mutations

Do not:
- copy server-rendered/server-owned data into a client store or client-remote-state tool merely to make it "globally available"
- treat all remote/server data as `client_remote_state_owner` state by default — start from `server_data_owner` and only move to client-owned tooling with a concrete reason
- use global client state to avoid prop drilling prematurely
- persist temporary UI state globally unless the behavior truly spans navigation or sessions

## 4. API and data boundaries

Frontend code should prefer:

- Server Components and server-side service/data-access modules for server-rendered data, calling the
  underlying service directly rather than making an HTTP round trip to a Route Handler in the same
  application
- Route Handlers only where an actual HTTP boundary is required (browser/API requests, webhooks,
  callbacks, external/public/partner consumers, BFF endpoints)
- Server Actions for frontend-originated mutations, following the same thin-boundary discipline as
  Route Handlers
- Zod schemas as the runtime contract at every trust boundary; derive TypeScript types from the
  schema rather than maintaining a duplicate hand-written interface
- explicit service/domain/application modules for business logic, kept out of `page.tsx`,
  `layout.tsx`, Route Handlers, Server Actions, and components
- explicit separation between transport DTO shapes and domain/UI-facing models when the transport
  shape is not UI-safe, using `mapXDtoToX` / `mapXToXDto` naming when mapping is needed

Do not:
- call HTTP clients directly from components when the data can be read from the server-side service
  layer directly
- embed business/domain logic directly inside `page.tsx`, `layout.tsx`, a Route Handler, or a Server
  Action
- let transport uncertainty leak deeply into UI code, or hide type mismatches behind broad casts
- treat authentication as equivalent to authorization; every Route Handler and Server Action that
  performs protected behavior must independently enforce authorization on the server — client-side
  hiding of UI is never a security boundary

## 5. Styling and accessibility

Use the repo's chosen styling system (Tailwind CSS by default in this stack), but new work should generally follow:

- component-local styling ownership
- reusable primitives only when reuse pressure is real
- semantic controls before ARIA
- keyboard-operable flows
- clear loading, empty, error, disabled, and success states — using `loading.tsx` / `error.tsx` /
  `not-found.tsx` route conventions where they have a real purpose, not ad hoc per-component
  reimplementations of framework-level states

## 6. Testing

This stack inherits the mandatory test-first lifecycle from `agents-core`.

Next.js-specific testing guidance:

- start with the smallest failing test for missing behavior
- Vitest cannot render `async` Server Components (an upstream Vitest/RSC limitation, not a policy
  choice — see `agent-docs/standards/testing/frontend-testing-standards.md`); prove `async` Server
  Component / route-rendering behavior with Playwright instead of forcing it into a component test
  with heavy mocking
- synchronous Server Components and Client Components are tested with Vitest + React Testing Library
- plain functions — Zod schemas, Server Actions, Route Handlers, service/domain modules — are
  ordinary `unit`-layer Vitest targets regardless of `async`, because they do not render JSX
- for `*.component.test.tsx` formatting, AAA annotation/spacing, and required co-location rules, follow `agent-docs/standards/coding/component-test-file-coding-standards.md`
- for `*.unit.test.ts` formatting and AAA annotation/spacing rules, follow `agent-docs/standards/coding/unit-test-file-coding-standards.md`
- for Playwright test formatting and AAA annotation/spacing rules, follow `agent-docs/standards/coding/playwright-test-file-coding-standards.md`
- add unit tests for isolated transformation, branching, or schema-validation logic where justified
- plan `e2e` coverage early and author/finalize it when the vertical flow exists
- discourage snapshot tests by default; prefer behavior-focused assertions
- preserve existing regression tests by default; do not alter or weaken them for new feature work or bug fixes unless the intended behavior contract is changing or the test is wrong/brittle
- only use snapshots when output is stable and presentation-heavy and the snapshot adds real signal

## 7. Agent collaboration

The shared core prompt/orchestration agents remain the workflow authority.
`delivery-engineer` (the Delivery Engineer) owns the slice end-to-end in one primary context and records each step per the core `handoff-template.md`.

This Next.js pack ships **no agent files**. Next.js-specific review, accessibility review,
state-ownership review, component-composition review, server/client-boundary review, and API
contract modelling are all inline lenses of `skills/review-change/`
(`references/{correctness,accessibility,react-composition,state-ownership,api-contracts,nextjs-boundary}.md`).

Review is diff-classified. Exactly one lens is always-on — correctness — and every other lens runs only when the diff actually touches its concern (see `agent-docs/workflows/feature-workflow-routing.md`). Lenses are `delegation: inline` unless the Delegation Gate is met, in which case the review is delegated to `Independent-Reviewer`. Diff classification never relaxes mandatory fail-closed workflow intake, bootstrap artifacts, or the always-on correctness lens; the closeout step record lists which lenses ran and why each skipped one was skipped.

Frontend feature and bug review lenses (diff-classified — full trigger table in `agent-docs/workflows/feature-workflow-routing.md`), applied inline via `skills/review-change/`:
- correctness lens — runs on **every** code change before PR-ready closeout
- accessibility lens — only when the diff changes interactive UI
- composition lens (`react-composition.md`) — only when component/hook/context/abstraction boundaries move
- state-ownership lens — only when owner/tier choice is unclear or changing
- api-contracts lens — only when request/response/error shapes, Zod schemas, nullability, or mapping boundaries are unclear or changing (contract modelling at plan time, contract review in the diff)
- nextjs-boundary lens (`nextjs-boundary.md`) — only when a `"use client"` boundary, Route Handler, Server Action, or trust-boundary validation point is added, moved, or unclear
- commit + push via the `commit-and-push` skill after the applicable review lenses pass with no blockers, pushing successful commit(s); this alone makes the workflow closeout-ready
- the `create-develop-pr` skill runs only on an explicit, separate PR request; when requested, it must return a live PR URL/number
- closeout must be blocked/awaiting-approval when push fails; a failed explicitly-requested PR blocks only that request, never workflow closeout
- trivial feature fast-path is allowed only when scope is localized and clear, and must still enforce test-first/evidence/review gates
- trivial bug fast-path is allowed only when scope is localized and clear, and must still enforce test-first/evidence/review gates

## 8. Tool mapping responsibility

Concrete package and tooling mandates belong in repo-local overlays, not this stack pack.

Repo-local `AGENTS.md` overlays should map:

- `capability_owners.local_ui_state_owner` implementation expectations
- `capability_owners.shared_client_state_owner` to the chosen shared-state tool, plus `capability_owners.shared_client_state_tier` (`subtree` | `cross_feature`)
- `capability_owners.server_data_owner` to the repo's server-side service/data-access layer
- `capability_owners.client_remote_state_owner` to the chosen client-state-tooling only where it is genuinely used
- `capability_owners.http_boundary_owner` and `capability_owners.mutation_boundary_owner` to the repo's Route Handler / Server Action conventions
- `test_layer_matrix` execution (`unit`, `component`, `integration`, `e2e`) to chosen test tooling
