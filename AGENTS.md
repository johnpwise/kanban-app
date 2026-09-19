# AGENTS.md

This app inherits shared workflow rules and Next.js stack guidance from:

- `.github/agents/agents-core/AGENTS.md`
- `.github/agents/nextjs-stack-pack/AGENTS.md`

## Project Facts

- Stack: Next.js (App Router) + React 19+ + TypeScript
- Routing: Next.js file-system routing (`src/app`)
- Local/shared UI state: React state/Context; Zustand for durable cross-feature client state (`src/store/appStore.ts`)
- Server-rendered/server-owned data: Server Components + `src/lib/services/*`
- HTTP boundary: Route Handlers (`src/app/api/**/route.ts`)
- Mutation boundary: Server Actions (`src/actions/*`)
- Runtime validation: Zod (`src/schemas/*`)

## capability_owners

- `local_ui_state_owner`: React local state/hooks
- `shared_client_state_owner`: Zustand (`shared_client_state_tier: cross_feature` by default; React Context for `subtree`)
- `server_data_owner`: Server Components + `src/lib/services/*`
- `client_remote_state_owner`: not used by default; add only with a concrete client-owned-remote-data reason
- `http_boundary_owner`: Route Handlers (`src/app/api/**/route.ts`)
- `mutation_boundary_owner`: Server Actions (`src/actions/*`)

## test_layer_matrix

- `unit`: `npm run test:unit`
- `component`: `npm run test:component`
- `integration`: `npm run test`
- `e2e`: `npm run test:e2e`

## Firebase / Firestore safety

A Firebase MCP server (Auth + Firestore only, via `firebase-tools mcp --only auth,firestore`) is registered project-scoped for this repo — see `.mcp.json` (Claude Code) and `.codex/config.toml` (Codex). It authenticates as the developer's own `firebase login` session, not a repo-held credential.

- Only one Firebase project is linked to this repo (`.firebaserc` → `kanban-app-fa4b7`); there is no dev/prod split. Treat it as production-equivalent.
- Never perform Firestore writes/deletes, Firebase Auth user mutations, Security Rules deploys, or any `firebase deploy` — via the MCP tools or the CLI — without explicit, in-the-moment user approval for that specific action.
- Read-only Firestore/Auth inspection (reading documents, listing users, checking rules) does not require approval each time.

### Working model

Agents should behave like junior developers being trained into this workflow.

That means agents are expected to:

* follow the established rules instead of improvising
* ask before making higher-risk or higher-scope changes
* justify decisions when introducing new structure or complexity
* prefer consistency, maintainability, and type safety over speed hacks

This is a prescriptive project. When in doubt, follow the documented standard rather than inventing a new pattern.

### Agent instruction sources

Agent guidance in this repo is sourced from:

1. root `AGENTS.md` (authoritative repo rules)
2. `.github/agents/nextjs-stack-pack/AGENTS.md` and `.github/agents/nextjs-stack-pack/agent-docs/...` (Next.js stack baseline)
3. `.github/agents/agents-core/AGENTS.md` and `.github/agents/agents-core/agent-docs/...` (core workflow baseline)

When guidance conflicts, earlier items in this list take precedence.

### Workflow inheritance sync

This repo inherits workflow defaults from `.github/agents/agents-core` and `.github/agents/nextjs-stack-pack`.
This overlay should document repo-specific facts, explicit local overrides, and approval boundaries only.

### Coding standards inheritance

Coding standards for generated Next.js code/tests are inherited from:

- `.github/agents/nextjs-stack-pack/agent-docs/standards/coding/*.md`
- `.github/agents/nextjs-stack-pack/agent-docs/standards/architecture/*.md`
- applicable quality/workflow constraints from `.github/agents/agents-core/AGENTS.md` and `.github/agents/agents-core/agent-docs/...`

### Policy ownership map

* `agents-core`: stack-neutral workflow governance, fail-closed mechanics, handoff/checkpoint contract, and test-evidence lifecycle.
* `nextjs-stack-pack`: Next.js workflow triggers/gates plus App Router / Server-Component / Client-Component / Route-Handler / Server-Action / Zod coding conventions.
* root `AGENTS.md`: project-specific runtime/tooling facts, architecture direction, local conventions, and concrete capability/test-tool mapping.

### Local workflow override

* Workflow artifacts must be persisted in `.agent-workflows/<workflow_id>/` for file-first routing.
* After workflow status is `closed`, `.agent-workflows/<workflow_id>/` must be deleted to avoid artifact buildup.

### Inherited workflow defaults (no local override)

* `delivery-engineer` remains the active workflow owner.
* Feature workflow entry requires a leading `New Feature` trigger.
* Bug workflow entry requires a leading `Bug Fix` trigger.
* Triggered requests run in fail-closed mode until `.agent-workflows/<workflow_id>/index.md` and the first workflow artifact is persisted.
* In fail-closed mode, the first response must report workflow ownership/routing state, not direct implementation edits.
* Every workflow step is recorded per the core `handoff-template.md` (compact Step Record; full Cross-Context Handoff Package only for a separate agent context).
* Default `Return To Agent` is `delivery-engineer.agent.md` unless an incoming handoff explicitly overrides it.
* One primary context owns the slice; re-enter the workflow-owner role explicitly only for `blocked`, `awaiting-approval`, or `ready-for-closeout`.
* Complexity is classified `trivial` vs `non-trivial` and the delivery is sequenced into TDD increments — inline, not a separate agent.
* Review is applied inline via `skills/review-change/`: the correctness lens runs on every code change; the accessibility, composition, state-ownership, and nextjs-boundary lenses are diff-classified. Delegate to `independent-reviewer.agent.md` only when the Delegation Gate is met.
* API contract modelling is a plan-time use of the `skills/review-change/` api-contracts lens.
* A blocking review-lens finding routes scoped rework inline, then the affected lenses re-run.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
