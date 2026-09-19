# Next.js Stack Pack

This stack pack is the Next.js layer intended to sit on top of the shared core agent pack.

## Intended layering

`agents-core` → `agents-nextjs` → repo-local overlay

The shared core pack owns:
- the Delivery Engineer, Architecture Advisor, and Independent Reviewer agents
- the inline delivery skills (feature-planning, tdd-slice, review-change, dependency-assessment, commit-and-push, create-develop-pr)
- execution-profile routing and the Delegation Gate
- generic handoff docs and workflow templates

This Next.js pack adds Next.js-specific review-lens content, stack policies, and framework-focused
guidance (no agent files — every stack specialist is an inline lens of the core
`skills/review-change/`) that can be reused across Next.js repositories. It targets Next.js as a
**full-stack React framework** — App Router, Server Components by default, Route Handlers, Server
Actions, and Zod-validated trust boundaries — not as another SPA build tool.

## Relationship to `react-stack-pack`

`react-stack-pack` (React + Vite SPA) is unchanged and remains the right choice for a client-only
SPA with no first-party server responsibilities. `nextjs-stack-pack` is a separate, first-class
stack for projects that want server rendering, Server Actions, or a first-party HTTP/BFF boundary
alongside the UI. Choosing `nextjs` does not require a separate Express backend — see
`agent-docs/standards/architecture/nextjs-server-client-boundary-standards.md` for when Next.js
covers the whole application and when an independent backend still earns its place.

## Included in this pack

### Agents

This pack ships no agent files. Next.js-specific review, accessibility review, state-ownership
review, component-composition review, server/client-boundary review, and API contract modelling are
all inline lenses of the core `skills/review-change/` skill
(`references/{correctness,accessibility,react-composition,state-ownership,api-contracts,nextjs-boundary}.md`).
An `independent` review dispatch uses the core `independent-reviewer.agent.md`.

### Docs
- `routing/model-routing-policy.md`
- `standards/coding/nextjs-file-coding-standards.md`
- `standards/coding/css-coding-standards.md`
- `standards/coding/component-test-file-coding-standards.md`
- `standards/coding/unit-test-file-coding-standards.md`
- `standards/coding/playwright-test-file-coding-standards.md`
- `standards/coding/runtime-validation-standards.md`
- `standards/testing/frontend-testing-standards.md`
- `standards/architecture/frontend-state-ownership-standards.md`
- `standards/architecture/nextjs-server-client-boundary-standards.md`
- `standards/reliability/frontend-styling-and-accessibility-standards.md`
- `standards/reliability/error-handling-and-caching-standards.md`
- `checklists/pr-ready-checklist.md`
- `workflows/feature-workflow-routing.md`
- `workflows/bug-workflow-routing.md`
- `prompts/nextjs-feature-intake.prompt.md`
- `prompts/nextjs-bug-intake.prompt.md`
- `prompts/bug-sweep.prompt.md`

This pack adds two doc categories the `react-stack-pack` does not need, because Next.js actually
renders on the server and exposes real HTTP/mutation boundaries that a Vite SPA does not have:
`standards/architecture/nextjs-server-client-boundary-standards.md` (Server/Client Component
ownership, Route Handlers, Server Actions, separate-backend policy) and
`standards/coding/runtime-validation-standards.md` (the Zod trust-boundary contract). It replaces
the React pack's Cypress standard with `standards/coding/playwright-test-file-coding-standards.md`,
and adds `standards/reliability/error-handling-and-caching-standards.md` for `error.tsx` /
`not-found.tsx` / `loading.tsx` and caching/revalidation ownership.

## Usage

1. Pull in the shared core pack first.
2. Add this pack alongside it.
3. Keep repo facts and exceptions in the local repo `AGENTS.md`.
4. In the local repo `AGENTS.md`, map `capability_owners` keys (`local_ui_state_owner`,
   `shared_client_state_owner`, `server_data_owner`, `client_remote_state_owner`,
   `http_boundary_owner`, `mutation_boundary_owner`), include
   `capability_owners.shared_client_state_tier` (`subtree` | `cross_feature`) when shared client
   ownership is used in new/updated frontend slices, and map `test_layer_matrix` execution to
   concrete packages/tooling used by that repo.
5. Record each step per the core `handoff-template.md` (compact Step Record; full Cross-Context Handoff Package only for a separate agent context).
6. Keep default handoff reentry to `delivery-engineer.agent.md`; one primary context owns the slice; re-enter `delivery-engineer` explicitly only for `blocked`/`awaiting-approval`/`ready-for-closeout`.
7. Apply `skills/review-change/` — the correctness lens on every code change, other lenses diff-classified (see feature-/bug-workflow-routing.md).
8. Override or supplement any policy only where the repo has a clear reason to diverge.
9. Persist workflow artifacts in `.agent-workflows/<workflow_id>/` and resolve fresh-context prompt files via `.agent-workflows/<workflow_id>/index.md`.
10. After workflow status is `closed`, delete `.agent-workflows/<workflow_id>/` to prevent artifact buildup.

## Adoption notes

This is the first pass of the Next.js stack pack, introduced alongside the existing `react` (Vite
SPA) and `vue` stacks without changing their behavior.

Copy these files together:

- `agent-docs/workflows/bug-workflow-routing.md`
- `agent-docs/workflows/feature-workflow-routing.md`
- `agent-docs/prompts/nextjs-bug-intake.prompt.md`
- `agent-docs/prompts/nextjs-feature-intake.prompt.md`
- `agent-docs/prompts/bug-sweep.prompt.md`
- `agents-core/agent-docs/prompts/delivery-engineer-auto-loop.prompt.md`
- `agent-docs/standards/coding/css-coding-standards.md`
- `agent-docs/standards/coding/component-test-file-coding-standards.md`
- `agent-docs/standards/coding/unit-test-file-coding-standards.md`
- `agent-docs/standards/coding/playwright-test-file-coding-standards.md`
- `agent-docs/standards/coding/runtime-validation-standards.md`
- `agent-docs/standards/architecture/nextjs-server-client-boundary-standards.md`
- `agent-docs/standards/reliability/error-handling-and-caching-standards.md`
- `agent-docs/checklists/pr-ready-checklist.md`
- `AGENTS.md`

## Design notes

This first pass is intentionally conservative:
- it preserves delivery-engineer ownership for intake/reentry/closeout while keeping one primary context per slice, delegating only when the Delegation Gate is met
- it keeps stack rules out of the generic core pack
- it avoids locking into one exact project shape
- it favors reusable review and boundary guidance over repo-specific implementation detail
- it does not blindly copy React/Vite SPA conventions (`src/views`, `src/router`, `App.tsx`,
  `main.tsx`) — Next.js gets a native `src/app` architecture instead
