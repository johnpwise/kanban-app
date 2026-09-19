---
name: start-hotfix
description: Create a hotfix/<version> branch from current main, bump the npm package/lockfile version to a user-supplied version, and commit and push the version bump. Use only on an explicit trigger such as "Start hotfix 1.4.1". Never chooses a version, never creates a PR or tag, never pushes directly to main or develop.
---

# Start Hotfix

Follow this workflow only when the user issues an explicit trigger of the exact form `Start hotfix <version>` (for example "Start hotfix 1.4.1"), recognised per the shared trigger-recognition standard. Do not infer a hotfix start from other phrasing, and do not choose or increment the version yourself — the user always supplies it. Treat this skill as the release-lifecycle template applied to `main` instead of `develop`; reuse `commit-and-push` rather than duplicating its commit/push procedure.

## Scope boundary

This skill creates a hotfix branch and commits a version bump. It never creates a pull request, never creates a tag, never merges, and never pushes directly to `main` or `develop` — only to the new `hotfix/<version>` branch. Package manager scope is **npm only**, identical to `start-release`; `pnpm` and `yarn` projects are out of scope.

## Version format

Accept only plain `MAJOR.MINOR.PATCH` (for example `1.4.1`), with no leading `v`, consistent with `start-release`. Reject pre-release (`1.4.1-rc.1`) or build-metadata (`1.4.1+build.5`) suffixes with a clear error.

## Preconditions (verify all before making any change)

1. The trigger supplies an explicit version matching plain `MAJOR.MINOR.PATCH`. If it does not match, stop and report the exact expected format.
2. The working tree is clean (`git status --short` has no output). If not, stop and report what is uncommitted.
3. `git fetch origin` succeeds and `main` exists as a remote branch.
4. Local `main` matches `origin/main` after fetch; do not discard local work to force this — if local `main` has unpushed commits or has diverged, stop and report the mismatch rather than resetting it.
5. Read the current version from root `package.json` on `main`. The supplied version must be strictly greater (by plain SemVer precedence on `MAJOR.MINOR.PATCH`) than the current version. If it is not, stop and report the current version and why the supplied version is rejected.
6. Check for a conflicting existing state:
   - If `hotfix/<version>` already exists locally or remotely: if it already contains exactly the supplied version in `package.json` and was created from the expected base, report this as an already-started hotfix (idempotent success). If it conflicts (different version, different base, or diverged history), stop and report the conflict.
   - If tag `v<version>` already exists locally or remotely, stop and report the conflict; do not create the branch.

## Workflow

1. Complete all preconditions above. Do not create the branch or touch any file until every precondition passes.
2. Create `hotfix/<version>` from `origin/main` (`git switch -c hotfix/<version> origin/main` or equivalent), before changing any package files.
3. Bump the version using the package-manager-safe npm equivalent: `npm version <version> --no-git-tag-version`.
4. Verify the resulting values exactly match the trigger:
   - Root `package.json` `"version"` field equals `<version>`.
   - The applicable root lockfile (`package-lock.json`) version field(s) equal `<version>`.
   - If either check fails, stop, do not commit or push, and report the exact mismatch.
5. Invoke the `commit-and-push` skill to commit only the version-bump files with the message `chore(release): prepare v<version>`, and push `hotfix/<version>` with upstream tracking.
6. Report completion: branch name, commit SHA, pushed remote/branch, and the verified version values. Do not create a PR or tag as part of this skill.

## After this skill: accumulating fix commits

Once `hotfix/<version>` is pushed, any actual fix work happens as normal commits on that branch via the generic `commit-and-push` skill, exactly like any other branch. This skill only prepares the branch and its version bump; it does not gate or wrap subsequent fix commits.

## Idempotency

If `Start hotfix <version>` is re-run and `hotfix/<version>` already exists, is pushed, and already contains exactly `<version>` in `package.json` and the lockfile, report that state as already complete rather than re-running the bump or creating a duplicate/conflicting commit.

## Failure handling

- Any precondition failure stops the skill before any file is touched or branch is created.
- If the branch is created but the version bump or verification fails, do not commit or push a partial hotfix; report the exact failed step and leave the branch for manual inspection.
- If `commit-and-push` reports a push failure, do not report success; surface the exact failure.
- Never push directly to `main` or `develop` under any circumstance in this skill.
