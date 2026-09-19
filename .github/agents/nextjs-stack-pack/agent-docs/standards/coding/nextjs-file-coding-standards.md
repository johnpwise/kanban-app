# nextjs-stack-policy.md

## Purpose

This document captures reusable Next.js stack policy that can be inherited by multiple repos.

Repo overlays should keep only facts and exceptions.

## Policy Baseline

### Next.js / React
- App Router only (`src/app`); no Pages Router (`pages/`) directory
- React 19+ functional components and hooks only
- Server Components by default; `"use client"` only for a justified reason (see
  `agent-docs/standards/architecture/nextjs-server-client-boundary-standards.md`)
- composition over inheritance
- avoid legacy lifecycle-era patterns

### TypeScript
- assume `strict: true`
- no `any`
- prefer explicit object shapes
- avoid broad casts that suppress real boundary problems
- at a trust boundary, derive the TypeScript type from its Zod schema (`z.infer<typeof schema>`)
  instead of maintaining a duplicate hand-written interface

### State
- apply core `capability_owners` with frontend keys: `local_ui_state_owner`,
  `shared_client_state_owner`, `server_data_owner`, `client_remote_state_owner`,
  `http_boundary_owner`, `mutation_boundary_owner`
- when `shared_client_state_owner` is used, include `capability_owners.shared_client_state_tier`
  with `subtree` or `cross_feature`
- prefer local state first, React Context/lifted tree state for `shared_client_state_tier: subtree`,
  and Zustand (or an equivalent store) only for `shared_client_state_tier: cross_feature`
- prefer `server_data_owner` (a Server Component or server-side service) over
  `client_remote_state_owner` for remote/persisted data; only use client-owned remote-state tooling
  for a genuinely client-driven need (polling, optimistic updates, long-lived client query state)
- remote data should not be mirrored into client state without strong justification

### API boundaries
- Route Handlers (`app/**/route.ts`) are the HTTP boundary; Server Actions are the mutation boundary
  for frontend-originated writes; both stay thin and delegate to service/domain modules
- components should not call HTTP clients directly when the data can be read from the server-side
  service layer
- service/domain modules should own business logic and transport details
- transport ambiguity should be normalized or modeled explicitly at the boundary
- untrusted input crossing any trust boundary is validated with Zod before domain logic uses it (see
  `agent-docs/standards/coding/runtime-validation-standards.md`)

### Styling
- Tailwind CSS by default; follow `agent-docs/standards/coding/css-coding-standards.md` for directive ordering
- new work should keep styling ownership close to the component/feature
- do not introduce new styling paradigms without approval

### Frontend directory organization

Next.js's file-system routing is the router; do not reintroduce a Vite/React-Router-era `src/router/`
or `src/views/` layer, and do not add a `main.tsx`/`App.tsx` client entry point — `src/app/layout.tsx`
is the root shell and `src/app/**/page.tsx` are the routed views.

- routes live under `src/app/`, using `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`,
  `not-found.tsx`, and `route.ts` only where each has a real purpose
- create shared components under `src/components/`
- each component should be contained in its own kebab-case folder (for example `mode-toggle`)
- component tests must be colocated with their same-named component and selector files in that folder
- canonical component structure: `src/components/mode-toggle/ModeToggle.tsx`,
  `src/components/mode-toggle/ModeToggle.component.test.tsx`, and
  `src/components/mode-toggle/ModeToggle.testIds.ts`
- under `src/features/`, any UI unit with paired `*.tsx` and `*.test.tsx` files should live in its own
  kebab-case subfolder with its selector constants beside it
- server-side business/domain logic lives under `src/lib/services/` (or `src/services/` for a larger
  repo); data-access/repository/integration modules live under `src/lib/data/` (or `src/data/`)
- Zod schemas live under `src/schemas/`, colocated by domain concept; derive types from them rather
  than duplicating an interface
- Server Actions live under `src/actions/` (or colocated with the feature that owns the mutation),
  one file per mutation surface, each starting with `"use server"`
- durable client-state stores (for example Zustand) live under `src/store/`
- avoid flat folders that mix multiple UI units and their tests/selectors at the same directory level
- the only source-root component-test exception is a root layout's own test, if one exists, beside
  its source file; all other component tests must be in a named UI-unit folder under
  `src/components/`, `src/features/`, or `src/app/<segment>/`

### Test selectors
- for elements asserted in `component`, `integration`, or `e2e` tests, define test IDs from
  script/module scope in a colocated `*.testIds.ts` file owned by the component, route segment, or
  feature unit
- do not create monolithic app-wide selector files such as `src/app/testIds.ts`
- `*_TEST_IDS` object keys should be `camelCase`; values should be stable, descriptive strings
- bind asserted target selectors with `data-id={APP_SHELL_TEST_IDS.shell}` rather than hard-coded
  `data-id` selector values in JSX/TSX
- require `data-id` only for asserted targets; do not add it indiscriminately to every element

### `"use client"` ownership
- a file either has `"use client"` at the top or it does not; do not add it "just in case"
- see `agent-docs/standards/architecture/nextjs-server-client-boundary-standards.md` for the full
  Server/Client Component decision model and the valid reasons to add `"use client"`

### Route Handlers and Server Actions
- `route.ts` and a Server Action file are transport/mutation boundaries, not business-logic modules —
  see `agent-docs/standards/architecture/nextjs-server-client-boundary-standards.md`
- do not let `page.tsx` or `route.ts` become a dumping ground for unrelated behavior; each owns one
  route segment's or one endpoint's concerns

### Import organization
Group imports in this order, with one blank line between groups and no blank lines within a group:

1. framework/vendor (`react`, `next/*`)
2. external libraries (`zod`, `zustand`, `lucide-react`, etc.)
3. application modules — services/data-access (`@/lib/...`)
4. components (`@/components/...`)
5. state/data modules — stores, schemas, actions (`@/store/...`, `@/schemas/...`, `@/actions/...`)
6. utilities (`@/lib/utils` or similar)
7. types-only imports (`import type { ... }`), styles (`import "./x.css"`) last

Do not invent a different ordering convention; follow this one so generated code is not lint-hostile
or autoformat-hostile.

### Quality gates
- inherit mandatory core test-first and evidence gates (`test_layer_matrix`,
  `preimplementation_failing_test_evidence`, required `e2e_status=passing` before closeout)
- lint and build should pass before closeout
- keep diffs scoped and reversible
- avoid unrelated cleanup in feature work

### Tooling policy boundary
- this stack pack stays tool-agnostic for package selection beyond the baseline established at
  bootstrap (Next.js, React, TypeScript, Tailwind CSS, Zod, Zustand, Vitest, React Testing Library,
  Playwright)
- repo-local overlays should map frontend `capability_owners` keys to concrete packages and test tools
- dependency/tool changes are assessed inline with `skills/dependency-assessment/`

### Housekeeping
- comments in the code are permissible
- you must not leave commented-out code, single lines or blocks
