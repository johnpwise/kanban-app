# nextjs-playwright-test-file-policy.md

## Purpose

This document defines formatting and structure standards for Playwright test files in Next.js-based
repos that inherit this stack pack. It replaces the `react-stack-pack`'s Cypress standard for this
stack: Playwright is the browser/E2E testing framework here (see
`agent-docs/standards/testing/frontend-testing-standards.md` for why). Cypress terminology below
appears only where explicitly comparing to the retired approach.

Repo overlays should keep only facts and exceptions.

## Formatting Baseline

## Existing test preservation
- treat the file's current assertions as a regression contract unless the intended behavior is explicitly changing
- do not weaken or delete an existing assertion merely to make a new implementation pass
- prefer adding new test cases for new behavior over rewriting existing ones
- if an existing test must change, keep the replacement focused on the same intended behavior and update it only as much as the contract change requires

### File scope
- each Playwright spec file should target one user-visible flow or behavior contract
- keep test setup in-file unless it is shared by 2+ spec files; promote shared setup to a fixture
  (see Fixtures below) rather than a copy-pasted helper
- avoid unrelated helper logic in the spec file; move reusable setup to a support/fixture module

### Import layout
- order imports as: `@playwright/test` (`test`, `expect`, fixtures), local fixtures/support modules,
  local test data/builders
- keep one import per line and group blocks with a single blank line

### Test structure
- one top-level `test.describe("<flow or page>")` block per file
- use `test("should ...")` phrasing for test names
- keep each test in Arrange-Act-Assert order with clear visual separation via blank lines
- require explicit AAA comment headers in every test: `// Arrange`, `// Act`, `// Assert`
- keep AAA blocks in strict order with no interleaving of actions and assertions
- separate AAA blocks with exactly one blank line between sections
- test names should communicate scenario and expected outcome
- prefer deterministic setup in `// Arrange` and keep navigation/interactions in `// Act`

Canonical pattern:

```ts
import { expect, test } from "@playwright/test";

test.describe("app shell", () => {
  test("should render app shell", async ({ page }) => {
    // Arrange

    // Act
    await page.goto("/");

    // Assert
    await expect(page.getByTestId("app-shell")).toBeVisible();
  });
});
```

## Locator hierarchy

Prefer locators in this order, matching the accessibility-first review lens:

1. **Role/accessible-name locators** (`page.getByRole("button", { name: "Subscribe" })`) — proves the
   element is actually accessible while also being a stable selector.
2. **Stable test IDs** (`page.getByTestId(...)`), for elements without a stable accessible role/name
   or where several similar controls need disambiguation.
3. **Label/text locators** (`getByLabel`, `getByText`) for form controls and static content where the
   text is part of the contract.
4. **CSS or XPath selectors** — avoid. A CSS-class or DOM-depth selector breaks on refactors and
   tells the reader nothing about intent; if no other locator fits, treat that as a signal the
   element needs a `data-id` selector, not a reason to reach for CSS.

### Stable test IDs (`data-id`)

This repository's stable-selector convention is `data-id`, not the Playwright/Testing Library
default `data-testid`. Configure Playwright to use it instead of migrating the repository's
convention:

```ts
// playwright.config.ts
use: {
  testIdAttribute: "data-id",
},
```

With this set, `page.getByTestId("app-shell")` resolves `[data-id="app-shell"]`. Bind selectors from
the same colocated `*_TEST_IDS` constants the component/component-test layer uses — never hard-code a
`data-id` string in a spec file.

## Waiting and assertion discipline

- use Playwright's built-in auto-waiting and web-first assertions (`await expect(locator)...`)
  instead of manual polling
- **no arbitrary sleeps** (`page.waitForTimeout(...)`) as a synchronization mechanism; wait on a
  locator state, a network response, or a URL/text assertion instead
- prefer `await expect(locator).toBeVisible()` / `.toHaveText(...)` / `.toHaveURL(...)` over a bare
  boolean check, so failures report the actual vs. expected state
- one primary assertion per test; tightly related follow-up assertions are allowed only when they
  validate the same behavior

## Deterministic setup and test isolation

- each test creates the state it needs; do not depend on execution order between tests or files
- prefer Playwright's built-in test isolation (a fresh browser context per test) over manual
  clean-up; do not share mutable state across tests via module-level variables
- when a flow needs seeded data, seed it explicitly in `// Arrange` (via a fixture, an API call, or
  a Server Action) rather than assuming prior state
- keep specs independent of run order and safe to run in parallel (`fullyParallel: true`)

## Fixtures

- use Playwright fixtures (`test.extend`) for setup that is shared across multiple spec files (for
  example an authenticated page, or a seeded resource), instead of duplicating setup code
- keep fixtures narrowly scoped to what they provide; do not build a generic "god fixture" that
  every spec imports regardless of need

## Authentication setup

When a flow requires an authenticated user, use Playwright's documented storage-state pattern (a
setup project that logs in once and reuses the saved storage state) rather than re-authenticating
through the UI in every spec. Document the concrete mechanism in the repo-local overlay once the
project has real authentication; the baseline bootstrap has no authentication to configure.

## Page Object usage policy

This stack pack does not mandate a Page Object Model. Prefer small, focused spec files using
locators and fixtures directly, matching the `react-stack-pack`'s flat-spec-file convention. If a
repo's flow complexity genuinely justifies a Page Object layer, introduce it deliberately in a
repo-local overlay and keep it thin — a Page Object should expose behavior (`await
homePage.subscribe(email)`), not just re-expose locators.

## Failure diagnostics

- `trace: "on-first-retry"` and `screenshot: "only-on-failure"` are the baseline (see
  `playwright.config.ts`) so a failing run produces a trace/screenshot without committing artifacts
  from green runs
- on a failure, inspect the trace (`npx playwright show-trace <path>`) before re-running blind
- do not disable diagnostics to make CI logs shorter; a failing test without diagnostics is a
  regression in the test infrastructure, not just the test

## Accessibility-aware interaction

- interact the way a user would: `locator.click()`, `locator.fill(...)`, `locator.press("Enter")` —
  not `page.evaluate(...)` to bypass the DOM
- prefer role/accessible-name locators (see Locator hierarchy above); a spec that can only find an
  element via CSS class is also a signal the element may be missing an accessible name
- assert on user-perceivable state (visible text, `aria-*` attributes reflecting state) rather than
  internal implementation details

## Avoiding assertion duplication with unit/component tests

Playwright specs prove framework-level integration and full user journeys — routing, rendering across
Server/Client Component boundaries, and real network/browser behavior. They are not the place to
re-verify a Zod schema's edge cases or a pure function's branches; that duplication belongs at
`unit`. Keep E2E assertions focused on what only a real browser + real server can prove.

## Quality gate alignment
- test files must satisfy lint and type-check gates
- changes should preserve test readability under standard formatter output
- keep diffs scoped to the user-visible behavior being validated
