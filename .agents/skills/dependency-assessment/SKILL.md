---
name: dependency-assessment
description: Assess a proposed dependency addition or version change with a bias toward minimalism, maintainability, and long-term cost — approve, reject, or defer. Use inline when a plan or an implementation increment needs a new package or a tooling change, before installing it. Replaces the retired dependency-governance agent.
---

# Dependency Assessment

Apply this skill **inline** when a delivery slice needs a new dependency or a version/tooling
change — it is procedure the Delivery Engineer runs in the primary context, not a separate agent.
The routine assessment is a short recorded judgement; a genuinely unusual decision is escalated to
**the user**, not to another agent.

## Assess

- **Problem solved** — is the dependency actually necessary, or does an in-repo capability already
  cover it?
- **Build vs buy** — what would the smallest in-house version cost against the package's ongoing
  cost?
- **Overhead** — runtime/bundle impact, maintenance burden, security surface, cognitive load,
  removal cost later.
- **Maturity and risk** — package maturity and maintenance health, lock-in risk, licensing or
  policy concerns.
- **Scope** — production dependency vs tooling-only; pick the narrowest acceptable change (a
  `devDependencies`-only tool is a lighter decision than a runtime dependency).

## Record (in the Step Record)

- dependency + version, and where it is used
- recommendation: **approve** / **reject** / **defer**, with a one- or two-line rationale
- alternatives considered
- risks introduced and any constraints if approved
- validation checks to run after install or upgrade (build, test suite, bundle size, licence scan
  as applicable)

## Escalate to the user

Get explicit approval before adding or changing a dependency that affects:

- production runtime
- the build pipeline or deployment environment
- developer tooling used broadly across the repo
- licensing or compliance posture

For those, present the assessment and the recommendation and wait — do not install first.

## Anti-goals

- Do not approve a package for convenience alone, or for trendiness.
- Do not hide long-term ownership cost.
- Do not expand scope: assess the dependency the slice needs, not a category of tooling.
