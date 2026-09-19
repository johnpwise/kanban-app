# coding-standards-shape.md

## Purpose

This is a style guide for authors of a stack pack's own `<stack>-file-coding-standards.md` (or
`<stack>-coding-standards.md`), not a copied template and not something any pack inherits content
from. Its only job is to record the section skeleton the existing coding-standards docs already
converged on independently, so a new stack pack (or a new section in an existing one) matches the
established shape instead of drifting into a bespoke structure. Follow it when authoring or
restructuring a coding-standards doc; do not treat it as a place to move existing content into.

## The shared skeleton

Every stack's coding-standards doc opens with:

- `## Purpose` — one or two sentences on what this doc governs.
- `## Policy Baseline`, immediately followed by a framework/language-named subsection (for
  example `### React`, `### Vue`, `### Next.js / React`, `### Node / Express`) covering the
  stack's core language/framework policy.

And closes with the same three subsections, in this order:

- `### Quality gates` — lint/build/test expectations the diff must satisfy.
- `### Tooling policy boundary` — what this doc governs vs. what belongs to a different
  standard/skill.
- `### Housekeeping` — cleanup expectations (dead code, unused deps, stray files).

`### API boundaries` also appears in every stack's doc, positioned between the domain-specific
middle sections and the closing three.

## Domain-specific middle sections (not shared, do not force a merge)

Frontend stacks (react, vue, nextjs) additionally cover, in this relative order: `### TypeScript`,
`### State`, `### API boundaries`, `### Styling`, `### Frontend directory organization`,
`### Test selectors`. Next.js inserts three further sections after directory organization that
have no react/vue counterpart: `### "use client" ownership`, `### Route Handlers and Server
Actions`, and `### Import organization` — these exist because Next.js has a real server/client
boundary and a Route Handler/Server Action transport layer that a Vite SPA does not.

Backend stacks (node-express, node-express-ts) additionally cover: `### Type safety`,
`### Architecture`, `### API boundaries`, `### Reliability`. The TypeScript backend pack inserts
`### Zod and DTOs` after Type safety, which the JS pack has no counterpart for.

These middle sections are **not** extracted into a shared base file: their content differs
meaningfully throughout (different language, different framework idioms, different concrete
examples), and forcing a merge would either blur real per-stack guidance or require constant
"restates the baseline as..." indirection for content that has almost nothing genuinely shared to
begin with. The value here is a consistent table of contents across stacks, not shared prose.
