# Bug Sweep Prompt

Review this Next.js codebase as a senior full-stack engineer doing a bug hunt and architecture review.

Your job is to inspect the project and produce a practical audit, not a rewrite.

## Focus Areas

- runtime bugs and likely failure points
- incorrect async handling, stale closures, race conditions, effect dependency mistakes, memory leaks, and state synchronization issues
- React-specific problems such as unnecessary re-renders, unstable keys, broken memoization, derived state mistakes, prop drilling, and component lifecycle bugs
- Next.js/App Router-specific problems such as: `"use client"` boundaries that are wider than needed; a Server Component that fetches through a same-app Route Handler instead of calling the service/data-access layer directly; server-only modules imported into Client Components; missing or misplaced `loading.tsx`/`error.tsx`/`not-found.tsx`; hydration mismatches; stale data after a mutation due to missing/incorrect `revalidatePath`/`revalidateTag`/`updateTag`; accidental caching of user-specific or authorization-sensitive data; a Route Handler or Server Action that skips authorization even though the caller is authenticated
- trust-boundary problems: any HTTP body, `FormData`, query/route param, webhook payload, or third-party payload consumed without Zod validation; a Zod schema that is looser than the actual constraint; a TypeScript type that duplicates (and can drift from) its Zod schema
- form and UI state issues such as uncontrolled/controlled input bugs, validation gaps, optimistic update failures, loading/error/empty state handling, and inconsistent UX behavior
- TypeScript issues such as unsafe casts, weak type boundaries, missing null handling, incorrect generics, and places where the types hide real bugs
- architectural issues such as tight coupling, poor separation of concerns, business logic embedded in `page.tsx`/`layout.tsx`/a Route Handler/a Server Action, god components, duplicated business logic, weak boundaries between components, hooks, services, and data-access modules, and over-complex abstractions
- maintainability issues such as dead code, inconsistent patterns, poor folder structure, unclear ownership of state, weak reusability, and poor testability
- accessibility issues such as missing semantics, keyboard traps, labeling issues, focus-management bugs (including focus after a client-side route transition), and screen-reader problems
- performance issues only where they are concrete and evidence-based, not speculative micro-optimizations

Project assumptions:

- Next.js App Router, `src/` directory
- React 19+ functional components and hooks
- strict TypeScript
- prefer local component state by default; Server Components by default for server-rendered/server-owned data
- Zod validates every trust boundary
- call out legacy or risky patterns explicitly
- do not recommend Redux or a client-side data-fetching library unless the codebase already depends on it or a genuine client-only remote-state need is demonstrated

Please do not give generic advice. Only report issues you can justify from the codebase.

## Per-Issue Requirements

For each issue you find, provide:

- a short title
- severity: critical, high, medium, or low
- the file(s) and component(s)/route(s)/handler(s) involved
- why it is a problem
- the likely user or production impact
- a concrete recommendation
- a minimal example patch or pseudocode fix when appropriate

## Required Output Format

- Executive summary
- top 5 risks
- overall architecture assessment
- Confirmed bugs and high-confidence defects
- Architectural and design issues
- Server/client boundary and trust-boundary issues
- Type safety issues
- Accessibility concerns
- Performance concerns
- Test coverage gaps
- Quick wins
- Questions / uncertainties where the code suggests a problem but evidence is incomplete

## Important Review Rules

- Be skeptical and specific
- Distinguish clearly between confirmed issues and suspected issues
- Prefer high-signal findings over long lists of style comments
- Do not praise the codebase unless it is directly relevant
- Do not rewrite entire modules unless necessary
- Flag missing context explicitly instead of guessing
- Prioritize issues that would matter in production
- If useful, infer the intended architecture and point out where the implementation violates it

When reviewing, pay special attention to:

- component responsibility and size
- `"use client"` boundary placement and size
- Route Handler and Server Action thinness, validation, and authorization
- hook design and hidden side effects
- state ownership and synchronization, including `server_data_owner` vs `client_remote_state_owner`
- data-fetching and caching/revalidation patterns
- error/loading/empty states, including `error.tsx`/`loading.tsx`/`not-found.tsx`
- accessibility and keyboard behavior
- testability of non-trivial logic

## More Aggressive Variant

```text
Treat this as a production-readiness review for a Next.js application that may already have hidden bugs. Inspect the codebase end-to-end and identify concrete defects, architectural weaknesses, trust-boundary gaps, accessibility issues, type-safety risks, and performance problems with evidence tied to files, components, routes, and handlers. Separate confirmed bugs from suspected issues. Prioritize user impact and maintainability, not style.
```

## Stack-Aware Add-On

```text
Pay special attention to the conventions and failure modes of the libraries actually used in this repository, such as Next.js App Router, React Server Components, Server Actions, Route Handlers, Zod, Zustand, TanStack Query (if present), Tailwind CSS, Vitest, React Testing Library, or Playwright.
```
