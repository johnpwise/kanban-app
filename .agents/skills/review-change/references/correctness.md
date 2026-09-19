# Correctness lens

Always runs. Review the diff against the stated behaviour — practical delivery review, concise,
prioritised, tied to the request. Split findings into must-fix (`changes-required`) and optional.

Frontend framing: modern React (hooks), Next.js (App Router: Server Components by default, `"use
client"` only where justified, Route Handlers/Server Actions as thin boundaries), or Vue (Composition
API), strict TypeScript, local state by default, dedicated server-state tooling for remote data,
behaviour-first tests, minimal diffs, no `any`, semantic HTML first, composition over inheritance.

Backend framing: Node/Express, explicit request/response boundaries, thin route handlers,
service-oriented business logic, structured error handling, clear persistence boundaries, no `any`
(TS stack: `any` only with explicit justification; types aligned with runtime schemas at trust
boundaries; clear DTOs between route, service, and repository layers).

## Review order

1. **Correctness** — does it implement the requested behaviour? Are success, loading/empty,
   disabled, error — and for backend, validation-failure, auth-failure, not-found, conflict, and
   dependency-failure — paths handled? Important edge cases covered?
2. **Scope control** — unrelated edits, diff larger than required, premature abstraction,
   opportunistic refactors, broad renames, formatting churn, helpers extracted without reuse
   pressure.
3. **Architecture fit** — state owned in the right place; components stay within UI concerns;
   API/service/persistence boundaries preserved; route handlers stay thin; `capability_owners`
   explicit and respected.
4. **Contract safety** (backend / boundary changes) — request/response shapes explicit and stable;
   status codes and error shapes consistent; a shared endpoint family has not drifted without
   reason.
5. **Type safety** — `any`, unsafe `as` casts to silence errors, weak nullable/optional handling,
   untyped remote data flowing through the UI, untrusted input treated as trusted.
6. **Render / reliability hygiene** — frontend: unnecessary re-renders, derived state stored
   instead of computed, unstable props/callbacks where it matters, expensive work in render,
   memoization without demonstrated need. Backend: swallowed errors, weak logging at failure
   boundaries, transaction/concurrency risk, missing validation or guardrails.
7. **Test quality** — see the evidence gates in `SKILL.md`; also brittle implementation-coupled
   assertions, untested branching / async / error paths, missing behaviour tests for non-trivial
   logic.

## Output into the Step Record

- overall status: `approve`, `approve-with-notes`, or `changes-required`, one-sentence rationale
- must-fix findings: file/area, issue, reason, smallest correction
- optional improvements: only genuinely useful follow-ups
- validation notes: what appears tested, what is missing or unclear
- test-evidence assessment: `test_layer_matrix`, `preimplementation_failing_test_evidence`,
  `e2e_status`; backend also `capability_owners` boundary owners
