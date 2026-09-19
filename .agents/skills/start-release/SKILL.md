---
name: start-release
description: Create a release/<version> branch from develop, bump the npm package/lockfile version to a user-supplied version, and commit and push the version bump. Use only on an explicit trigger such as "Start release 1.4.0". Never chooses a version, never creates a PR or tag.
---

# Start Release

Follow this workflow only when the user issues an explicit trigger of the exact form `Start release <version>` (for example "Start release 1.4.0"), recognised per the shared trigger-recognition standard. Do not infer a release start from other phrasing, and do not choose or increment the version yourself — the user always supplies it.

## Scope boundary

This skill creates a release branch and commits a version bump. It never creates a pull request, never creates a tag, never merges, and never deletes branches. Package manager scope for this skill is **npm only**; every currently supported bootstrapped project (React, Next.js, Vue, Node/Express, Node/Express TypeScript) uses npm exclusively. `pnpm` and `yarn` projects are explicitly out of scope for this version of the skill — do not attempt `pnpm version` or `yarn version` equivalents; if the target repository is not npm-based, stop and report that this skill does not yet support it.

## Version format

Accept only plain `MAJOR.MINOR.PATCH` (for example `1.4.0`), with no leading `v`. Reject any version containing a pre-release suffix (`1.4.0-rc.1`) or build-metadata suffix (`1.4.0+build.5`) with a clear error; these are out of scope for this version of the skill, not silently coerced or accepted.

## Preconditions (verify all before making any change)

1. The trigger supplies an explicit version matching plain `MAJOR.MINOR.PATCH`. If it does not match, stop and report the exact expected format.
2. The working tree is clean (`git status --short` has no output). If not, stop and report what is uncommitted.
3. `git fetch origin` succeeds and `develop` exists as a remote branch.
4. The local `develop` (or the branch about to be used as the release source) matches `origin/develop` after fetch; do not discard local work to force this — if local `develop` has unpushed commits or has diverged, stop and report the mismatch rather than resetting it.
5. Read the current version from root `package.json` on `develop`. The supplied version must be strictly greater (by plain SemVer precedence on `MAJOR.MINOR.PATCH`) than the current version. If it is not, stop and report the current version and why the supplied version is rejected.
6. Check for a conflicting existing state:
   - If `release/<version>` already exists locally or remotely: inspect it. If it already contains exactly the supplied version in `package.json` and was created from the expected base, report this as an already-started release (idempotent success) rather than erroring. If it conflicts (different version, different base, or diverged history), stop and report the conflict.
   - If tag `v<version>` already exists locally or remotely, stop and report the conflict; do not create the branch.

## Workflow

1. Complete all preconditions above. Do not create the branch or touch any file until every precondition passes.
2. Create `release/<version>` from `develop` (`git switch -c release/<version> develop` or equivalent), before changing any package files.
3. Bump the version using the package-manager-safe npm equivalent: `npm version <version> --no-git-tag-version` (this updates `package.json` without creating a git tag or a commit).
4. Verify the resulting values exactly match the trigger:
   - Root `package.json` `"version"` field equals `<version>`.
   - The applicable root lockfile (`package-lock.json`) version field(s) equal `<version>`.
   - If either check fails, stop, do not commit or push, and report the exact mismatch.
5. Invoke the `commit-and-push` skill to commit only the version-bump files (`package.json`, `package-lock.json`, and any other file `npm version` modified) with the message `chore(release): prepare v<version>`, and push `release/<version>` with upstream tracking.
6. Report completion: branch name, commit SHA, pushed remote/branch, and the verified version values. Do not create a PR or tag as part of this skill.

## Idempotency

If `Start release <version>` is re-run and `release/<version>` already exists, is pushed, and already contains exactly `<version>` in `package.json` and the lockfile, report that state as already complete rather than re-running the bump or creating a duplicate/conflicting commit.

## Failure handling

- Any precondition failure stops the skill before any file is touched or branch is created.
- If the branch is created but the version bump or verification fails, do not commit or push a partial release; report the exact failed step and leave the branch for manual inspection (do not auto-delete it).
- If `commit-and-push` reports a push failure, do not report success; surface the exact failure.
