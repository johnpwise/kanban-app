---
name: finalise-release
description: Verify both release PRs (release/<version> into main and into develop) were merged, resolve the exact main merge commit from PR evidence, verify its package version, tag it via create-annotated-tag, and clean up the release branch. Use only on an explicit trigger such as "Finalise release 1.4.0", after create-release-prs and after both PRs have been manually merged.
---

# Finalise Release

Follow this workflow only when the user issues an explicit trigger of the exact form `Finalise release <version>` (for example "Finalise release 1.4.0"), recognised per the shared trigger-recognition standard. This skill performs no merges itself — it verifies merges that already happened and tags the result.

## Scope boundary

This skill verifies, tags, and cleans up. It never merges a PR, never force-pushes, never rewrites history, and never tags a commit it has not specifically verified through PR evidence.

## Version format

Accept only plain `MAJOR.MINOR.PATCH` (for example `1.4.0`), with no leading `v`, consistent with `start-release` and `create-release-prs`. Resolve `release/<version>` and tag name `v<version>` from it.

## Workflow

1. `git fetch origin --tags`.
2. Find the two release PRs for `release/<version>`:
   - PR from `release/<version>` into `main`.
   - PR from `release/<version>` into `develop`.
   - Use `gh pr list --head release/<version> --state all --json number,baseRefName,state,mergeCommit` (or equivalent) to locate both, regardless of open/closed/merged state.
3. Verify both are merged. If either is not in a merged state, stop and report which PR(s) are not merged; do not proceed to tagging, and do not merge them yourself.
4. Resolve the exact commit that landed on `main`:
   - Read the merge commit SHA directly from the `main`-targeting PR's own merge evidence (for example `gh pr view <number> --json mergeCommit`), not from the current tip of `main`. Other commits may have merged to `main` after this release, so `main`'s current tip is not reliable evidence on its own.
   - If the merge commit cannot be resolved unambiguously from PR evidence, stop and report the ambiguity rather than guessing.
5. Verify the package version at that exact commit:
   - Read root `package.json` as it exists at the resolved merge commit (for example `git show <merge-commit>:package.json`).
   - Confirm its `"version"` field equals exactly `<version>`. If it does not, stop and report the mismatch; do not tag.
6. Invoke the `create-annotated-tag` skill to create and push `v<version>` at the resolved merge commit, with annotation `Release v<version>`. Do not duplicate its tag-creation or verification logic here — let it handle conflict detection, idempotency, and remote verification.
7. Only after the tag is created and verified, clean up `release/<version>`:
   - Delete the remote branch: `git push origin --delete release/<version>`.
   - Delete the local branch if present: `git branch -d release/<version>`.
   - If the branch was already removed (for example, GitHub auto-deleted it after merge), treat this as a reportable idempotent state, not an error.
8. Report: both PR references (number, merge commit for the `main` PR), the resolved and verified merge commit, the tag created (or confirmed idempotent), and branch cleanup status.

## Idempotency

Re-running this skill after successful finalisation must recognise the already-created tag (via `create-annotated-tag`'s own idempotency) and the already-removed branch, and report success without erroring.

## Failure handling

- If either PR is not merged, stop before any tagging or cleanup.
- If the `main` merge commit cannot be resolved unambiguously from PR evidence, stop and report why.
- If the package version at the resolved commit does not match, stop and report the mismatch; do not tag.
- If `create-annotated-tag` reports a conflicting existing tag (pointing at a different commit) or a verification failure, surface that failure directly; do not attempt to force past it.
- If branch cleanup fails after a successful tag, report the tag success separately from the cleanup failure — do not let a cleanup failure imply the release itself failed.
- Never merge a PR, rewrite history, or tag a commit that has not been verified against both PR merge state and package version.
