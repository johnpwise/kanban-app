# frontend-testing-playbook.md

## Purpose

This playbook defines a reusable testing stance for Next.js repositories.

## Default testing philosophy

Prefer the smallest useful set of tests that proves behavior, catches regressions, and remains easy to maintain. Apply risk-based test allocation — do not duplicate the same assertion across every layer.

## `test_layer_matrix`

| Layer | Tooling | Covers |
| --- | --- | --- |
| `unit` | Vitest | Plain functions, Zod schemas, service/domain modules, Server Actions, Route Handlers — anything that does not render JSX, `async` or not. |
| `schema` | Vitest + Zod | Trust-boundary schema contracts (accept-valid / reject-invalid, including edge cases at the boundary). Reported under `unit` in `test_layer_matrix` unless the repo overlay splits it out. |
| `component` | Vitest + React Testing Library | Synchronous Server Components and Client Components. Does not cover `async` Server Components — see below. |
| `integration` | Vitest (combined `unit`+`component` run) | Logic- and sync-component-level integration. Framework-level route/rendering integration is covered by `e2e`, not a separate Vitest config, because Vitest cannot render `async` Server Components. |
| `e2e` | Playwright | Full user journeys, routing, `async` Server Component rendering, and real Server Action/Route Handler execution against a running app. |

## Server Components and Vitest — an explicit limitation, not a policy choice

Vitest (via `jsdom` + React Testing Library) cannot render an `async` Server Component; this is an
upstream limitation of the current React Server Components ecosystem, documented by Next.js itself.
Do not assume every App Router component can or should be rendered through jsdom-based component
testing, and do not introduce heavy mocking merely to force `async` Server Component behavior into a
component test that does not model the framework correctly. Where framework execution is required to
prove the behavior, prefer Playwright.

Synchronous Server Components (no `async` keyword, no awaited data) and Client Components render
fine under Vitest + React Testing Library and belong at `component`.

## Mandatory sequencing

## Regression suite preservation

Treat existing tests as regression contracts for current behavior.

- preserve existing tests by default
- do not rewrite, weaken, or remove an existing assertion merely to fit a new implementation
- when a change introduces new behavior, add new tests first and keep prior coverage intact unless the prior contract is intentionally changing
- modify an existing test only when the product behavior is intentionally changing, the prior test is incorrect, or the test is too brittle/implementation-coupled to continue expressing the intended behavior
- when an existing test is changed, document the reason in the work summary or handoff in contract terms

This stack inherits sequencing and evidence gates from `agents-core`:
- `test_layer_matrix` must be explicit
- `required_preimplementation_tests` must fail before production code changes
- required `e2e_status` must be planned early and be `passing` before closeout

### Start with the first failing behavior
For non-trivial work:
1. identify the missing behavior
2. write the smallest failing test that proves it
3. implement the minimum code to pass
4. refactor only after green

### Prefer behavior-first coverage
Prioritize tests that validate:
- what the user sees
- what the user can do
- what happens after an action, including a Server Action mutation
- how the UI responds to async outcomes

Avoid spending most effort on:
- private helper implementation
- brittle DOM structure
- hook internals with no user-visible value
- re-proving a Zod schema's edge cases at `e2e` when a `unit` test already covers them

### Suggested coverage order
1. primary success path
2. loading and submitting states (including a pending Server Action)
3. error and recovery path
4. empty or missing-data path
5. edge conditions with meaningful regression risk

### Suggested test split
Usually prefer:
- a small number of high-signal component/integration tests for synchronous Server/Client Components
- focused unit tests for Zod schemas, service/domain logic, Server Actions, and Route Handlers
- selective end-to-end coverage for truly important journeys and any `async` Server Component
  rendering, planned before implementation and finalized before closeout when required

### Selector policy for asserted targets
- for elements asserted in `component`, `integration`, or `e2e` tests, bind selectors from a colocated script/module-defined `*_TEST_IDS` constant object
- do not hard-code `data-id` selector values in JSX for asserted targets
- configure Testing Library with `testIdAttribute: "data-id"` before using `getByTestId` queries
- query asserted targets by configured `data-id` in component/integration tests (example: `screen.getByTestId(APP_SHELL_TEST_IDS.shell)`)
- configure Playwright with `testIdAttribute: "data-id"` and use app-owned constants with
  `page.getByTestId(APP_SHELL_TEST_IDS.shell)` for asserted targets in `e2e`; prefer
  role/accessible-name locators first where they are stable (see
  `agent-docs/standards/coding/playwright-test-file-coding-standards.md`)

### Common omissions to catch
- duplicate-submit protection, including a pending Server Action allowing a double submit
- disabled state behavior
- retry flows
- stale state after navigation or rerender
- stale data after a mutation that should have triggered revalidation
- ambiguous success messaging
- branch behavior hidden behind nullability
- a Route Handler or Server Action missing authorization even though the caller is authenticated
