# Bug Sweep Prompt

Review this Node.js / Express API codebase as a senior backend engineer doing a bug hunt and architecture review.

Your job is to inspect the project and produce a practical audit, not a rewrite.

## Focus Areas

- runtime bugs and likely failure points
- incorrect async handling, unhandled promises, race conditions
- Express-specific issues such as middleware order, error handling, response lifecycle bugs, missing returns, double sends, and route design problems
- security issues such as auth flaws, unsafe input handling, injection risks, secret leakage, insecure defaults, weak session or token handling, and missing validation
- data layer problems such as transaction issues, N+1 queries, bad migrations, schema mismatches, poor indexing assumptions, and unsafe query construction
- architectural issues such as tight coupling, poor separation of concerns, god modules, circular dependencies, duplicated business logic, hidden side effects, and weak boundaries between routes, services, repositories, and utilities
- maintainability issues such as unclear abstractions, dead code, inconsistent patterns, missing types or contracts, poor config structure, and weak testability
- reliability and operability issues such as logging gaps, poor observability, brittle configuration, startup failure risks, and missing health/error handling
- performance issues only where they are concrete and evidence-based, not speculative micro-optimizations

Please do not give generic advice. Only report issues you can justify from the codebase.

## Per-Issue Requirements

For each issue you find, provide:

- a short title
- severity: critical, high, medium, or low
- the file(s) and function(s) involved
- why it is a problem
- the likely impact in production
- a concrete recommendation
- a minimal example patch or pseudocode fix when appropriate

## Required Output Format

- Executive summary
- top 5 risks
- overall architecture assessment
- Confirmed bugs and high-confidence defects
- Architectural and design issues
- Security concerns
- Reliability and operational concerns
- Test coverage gaps
- Quick wins
- Questions / uncertainties where the code suggests a problem but evidence is incomplete

## Important Review Rules

- Be skeptical and specific
- Distinguish clearly between confirmed issues and suspected issues
- Prefer high-signal findings over long lists of minor style comments
- Do not praise the codebase unless it is directly relevant
- Do not rewrite entire modules unless necessary
- Flag missing context explicitly instead of guessing
- Prioritize issues that would matter in production
- If useful, infer the intended architecture and point out where the implementation violates it

## More Aggressive Variant

```text
Treat this as a production-readiness review for a Node.js / Express API that may already have hidden bugs. Inspect the codebase end-to-end and identify concrete defects, architectural weaknesses, security risks, and operational blind spots. I want a brutally honest review with evidence tied to files and functions. Separate confirmed bugs from suspected issues. Prioritize production impact, not style.
```
