# nextjs-unit-test-file-policy.md

## Purpose

This document defines formatting and structure standards for `*.unit.test.ts` files in Next.js-based repos that inherit this stack pack.

Repo overlays should keep only facts and exceptions.

## Formatting Baseline

## Existing test preservation
- treat the file's current assertions as a regression contract unless the intended behavior is explicitly changing
- do not weaken or delete an existing assertion merely to make a new implementation pass
- prefer adding new test cases for new behavior over rewriting existing ones
- if an existing test must change, keep the replacement focused on the same intended behavior and update it only as much as the contract change requires

### Scope of this layer
A `*.unit.test.ts` file targets a plain function, Zod schema, service/domain module, Server Action,
or Route Handler — anything that does not render JSX. `async` is not a reason to move a target out of
this layer: only rendering an `async` Server Component requires Playwright instead (see
`agent-docs/standards/testing/frontend-testing-standards.md`).

### File scope
- each `*.unit.test.ts` file should target one unit contract (function, Zod schema, mapper,
  store/service unit, Server Action, Route Handler, or isolated branching logic)
- keep test setup in-file unless it is shared by 2+ test files
- avoid unrelated helper logic in the test file; move reusable setup to a test utility module

### Import layout
- order imports as: test framework, subject-under-test dependencies, local test utilities
- prefer explicit named imports over broad namespace imports
- keep one import per line and group blocks with a single blank line

### Test structure
- one top-level `describe("<unit name>")` block per file
- use `it("should ...")` phrasing for test names
- require explicit AAA comment headers in every test: `// Arrange`, `// Act`, `// Assert`
- preserve logical AAA flow and keep state setup isolated from mutations/assertions
- repeated `// Act` and `// Assert` cycles are allowed in a single test when validating staged state transitions of the same behavior
- separate each AAA section with exactly one blank line
- test names should communicate scenario and expected outcome

Canonical pattern (a Zod schema at a trust boundary):

```ts
import { describe, expect, it } from "vitest";

import { subscribeRequestSchema } from "../schemas/subscribe";

describe("subscribeRequestSchema", () => {
  it("should accept a well-formed email", () => {
    // Arrange
    const input = { email: "person@example.com" };

    // Act
    const result = subscribeRequestSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(true);
  });

  it("should reject a malformed email", () => {
    // Arrange
    const input = { email: "not-an-email" };

    // Act
    const result = subscribeRequestSchema.safeParse(input);

    // Assert
    expect(result.success).toBe(false);
  });
});
```

### Mocks and test doubles
- mock only external boundaries (time, random, network adapters, third-party SDKs, process/env boundaries)
- do not mock the unit internals that represent the behavior under test
- keep mock setup near the tests that rely on it; reset/restore in lifecycle hooks

### Assertions and async handling
- keep one behavioral concern per test case
- prefer specific assertions over broad snapshots
- place assertions only in `// Assert` sections
- for async units (Server Actions, Route Handlers, service calls), use await-based synchronization and avoid arbitrary timeouts
- test output should be deterministic across local and CI runs

### Quality gate alignment
- test files must satisfy lint and type-check gates
- changes should preserve test readability under standard formatter output
- keep diffs scoped to the unit behavior being validated
