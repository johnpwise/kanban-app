---
name: tdd-slice
description: Drive one TDD increment through RED, GREEN, and REFACTOR in a single context, with a runtime and compatibility audit before handoff. Use for every TDD increment of a delivery slice, after feature-planning. Replaces the retired implementation-engineer agent.
---

# TDD Slice

Apply this skill **inline** for each TDD increment from the plan — a small RED → GREEN → REFACTOR
cycle for one behaviour, not a nested workflow. RED, GREEN, and REFACTOR are states you move
through in the primary context, not separate agents. The test runner is the gatekeeper. See the
Vocabulary in `skills/feature-planning/SKILL.md` for slice / increment / behaviour.

## RED — capture the failing test first

1. Confirm the approved `capability_owners` and `test_layer_matrix` for this increment (and, for a
   frontend increment using `shared_client_state_owner`, `shared_client_state_tier`).
2. Write the `required_preimplementation_tests` for the new behaviour.
3. Run them and confirm they **fail for the right reason**. Record the exact command and result.
   For a new Slice 2 workflow, update each matching `expectedRedEvidence` entry to `captured` with
   command, non-zero exit code, and observed failure, then validate the canonical slice spec at
   `implementation-ready`.
4. Do not edit production behaviour until this failing evidence exists. Verify with:

   ```sh
   node scripts/verify-red-before-production-change.mjs --test "<test command>"
   ```

   It confirms the test fails and no production file is modified yet. (The script lives in this
   repository's `scripts/`; a consumer project can copy it or apply the check by hand — run the
   test, see it fail, check `git status` shows no production edit.)

## GREEN — smallest change that passes

- Implement the minimum change that makes the failing test pass. Prefer direct, readable
  solutions.
- Keep diffs small, reviewable, and reversible. Preserve behaviour outside the intended scope.
- Do not introduce new dependencies, and do not perform broad refactors, without approval.
- Keep naming, structure, and conventions aligned with the repository.
- Record the GREEN command and result.

## REFACTOR — clean up under green

Improve names, structure, and duplication with the tests passing. Re-run the affected layers after
each refactor. Avoid unrelated cleanup.

## Runtime and compatibility audit (before handoff)

The implementation must be valid at a real runtime and operational level, not only at a code
level. Before the increment is done, explicitly check and record:

- **Production runtime composition** — did it change? No test-only or workflow-specific behaviour
  in production wiring (`process.argv` branching, validation-only env switches, swapping real
  infrastructure for in-memory inside production composition, conditional DI that changes runtime
  behaviour). Alternate wiring for tests belongs in test setup / fixtures / non-production
  entrypoints.
- **Real runtime contract** — the change is validated against the same contract used in
  production, not one where a real dependency is bypassed or redirected to a stub.
- **Compatibility surfaces** — for every change, especially renames, assess impact across: routes
  and URL paths; controller/service/repository contracts; database / Firestore collection names;
  persisted document structure, keys, fields; environment variables; config property names; DI
  option names; cache keys and TTL; external API contracts; README / setup / operational docs.
- **Implicit breaking changes** — if persistence names, config keys, env vars, DI option names, or
  runtime contracts changed, either preserve backward compatibility or document the breaking
  change with migration steps. Never leave the impact implicit.

Record in the canonical slice spec's observations/verification as yes/no + explanation:
production composition change; test-only behaviour in production
code; persistence impact; config/env impact; DI/injected-option impact; backward-compatibility
status (preserved / broken + justification); migration or documentation required.

## Increment completion

The increment is ready when the work is within approved scope, understandable, validation-aware,
explicit about `preimplementation_failing_test_evidence` for required layers, explicit about
`e2e_status`, explicit about runtime and compatibility impacts, and explicit about anything not
completed. Then apply the diff-classified review lenses.

## Escalation

- An architecture boundary problem surfaces mid-increment → consult `architecture-advisor` only if
  the Delegation Gate is met; otherwise raise `reasoning_demand` and resolve it in context.
- The approved path needs a new package or tooling change → assess it inline with
  `skills/dependency-assessment/`, escalating a genuinely unusual one to the user.
- The required failing-test evidence cannot be produced, or the approved scope is contradicted by
  the codebase → stop and re-enter the workflow-owner role as `blocked`.
