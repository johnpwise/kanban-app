# Commit message guidelines

## Conventional commit types

- `feat`: add or change user-visible behavior
- `fix`: resolve a defect
- `test`: add or update tests
- `refactor`: change internal design without behavior change
- `docs`: documentation-only updates
- `chore`: maintenance or tooling updates that are not `build`, `ci`, or `deps`
- `build`: changes to the build system or package dependencies
- `ci`: changes to CI configuration or scripts
- `perf`: a performance improvement
- `style`: formatting-only changes with no code meaning change
- `revert`: reverts a previous commit

## Selecting the type

Select the type from the actual diff content, not from the branch name. A single `feature/*` branch can legitimately produce `feat`, `test`, `docs`, `refactor`, or `fix` commits across its history; a `release/*` branch preparing a version bump uses `chore(release): ...` regardless of what type of branch it was cut from.

## Subject examples

- `feat(auth): add refresh-token rotation on session renew`
- `fix(api): handle missing customer email in webhook payload`
- `test(checkout): cover empty-cart submit rejection`
- `chore(release): prepare v1.4.0`
- `docs(skills): document commit-and-push workflow`

## Body template

Use a body only when it adds information the subject cannot carry:

```text
Why:
- <context or problem>

What changed:
- <change 1>
- <change 2>

Validation:
- <command/result>
```

## Scope heuristics

- Use narrow scope names (`auth`, `api`, `frontend`, `release`, `docs`).
- Omit scope only when the change is repository-wide and no narrow scope fits.

## Split commit heuristics

Create separate commits when a diff mixes:

- behavior changes and formatting-only changes
- refactors and bug fixes
- docs updates and production code updates
- unrelated features or fixes
