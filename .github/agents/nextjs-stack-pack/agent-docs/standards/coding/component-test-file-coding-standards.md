# nextjs-component-test-file-policy.md

## Purpose

This document defines formatting and structure standards for `*.component.test.tsx` files in Next.js-based repos that inherit this stack pack.

Repo overlays should keep only facts and exceptions.

## Formatting Baseline

## Existing test preservation
- treat the file's current assertions as a regression contract unless the intended behavior is explicitly changing
- do not weaken or delete an existing assertion merely to make a new implementation pass
- prefer adding new test cases for new behavior over rewriting existing ones
- if an existing test must change, keep the replacement focused on the same intended behavior and update it only as much as the contract change requires

### Scope of this layer — Vitest cannot render `async` Server Components
Vitest (via `@testing-library/react` + `jsdom`) can render **synchronous** components — Client
Components and synchronous Server Components — but cannot render an `async` Server Component; this
is an upstream Vitest/React Server Components limitation, not a policy choice. Do not reach for heavy
mocking to force an `async` Server Component through this layer. If the behavior genuinely requires
rendering an `async` Server Component, prove it with Playwright instead (see
`agent-docs/standards/testing/frontend-testing-standards.md`) and keep this layer for the
synchronous/Client Component surface.

### File scope
- each `*.component.test.tsx` file should target one component contract
- colocate `*.component.test.tsx` with its same-named `.tsx` component and selector constants in the same UI unit folder
- run `npm run test:component` so `validate:component-layout` rejects a misplaced component test before Vitest runs
- keep test setup in-file unless it is shared by 2+ test files
- avoid unrelated helper logic in the test file; move reusable setup to a test utility module

### Import layout
- order imports as: test framework, React test utilities, app modules, local test utilities
- prefer explicit named imports over broad namespace imports
- keep one import per line and group blocks with a single blank line

### Test structure
- one top-level `describe("<ComponentName>")` block per file
- use `it("should ...")` phrasing for test names
- keep each test in Arrange-Act-Assert order with clear visual separation via blank lines
- require explicit AAA comment headers in every test: `// Arrange`, `// Act`, `// Assert`
- keep AAA blocks in strict order with no interleaving of actions and assertions
- separate AAA blocks with exactly one blank line between sections
- test names should communicate scenario and expected outcome
- avoid deeply nested `describe` blocks unless they define a distinct behavior context

### Selector and query usage
- for asserted UI targets, prefer colocated `*_TEST_IDS` ownership patterns defined by stack policy
- in `vitest` component tests, default to `screen.getByTestId` for asserted targets after Testing Library has been configured with `testIdAttribute: "data-id"`
- use alternative queries only when `data-id` is not appropriate for the interaction or assertion
- avoid brittle selectors based on CSS class names or DOM depth

### Mocking and doubles
- mock only external boundaries (`next/navigation` hooks such as `useRouter`/`usePathname`/`useSearchParams`, network, time, random)
- do not mock component internals that are part of the behavior under test
- keep mock setup near the tests that rely on it; reset/restore in lifecycle hooks

### Assertions and async handling
- keep one behavioral concern per test case
- keep one primary assertion per test; tightly related follow-up assertions are allowed only when they validate the same behavior
- place assertions only in the `// Assert` section
- prefer specific assertions over broad snapshots
- for async rendering, use await-based stabilization patterns and avoid arbitrary timeouts
- test output should be deterministic across local and CI runs

### Quality gate alignment
- test files must satisfy lint and type-check gates
- changes should preserve test readability under standard formatter output
- keep diffs scoped to the component behavior being validated
