---
name: finalise-hotfix
description: Verify both hotfix PRs (hotfix/<version> into main and into develop) were merged, resolve the exact main merge commit from PR evidence, verify its package version, tag it via create-annotated-tag, and clean up the hotfix branch. Use only on an explicit trigger such as "Finalise hotfix 1.4.1", after create-hotfix-prs and after both PRs have been manually merged.
---

# Finalise Hotfix

Follow this workflow only when the user issues an explicit trigger of the exact form `Finalise hotfix <version>` (for example "Finalise hotfix 1.4.1"), recognised per the shared trigger-recognition standard. This is the hotfix-lifecycle equivalent of `finalise-release`, operating on `hotfix/<version>` instead of `release/<version>`; the verification and tagging logic is identical. This skill performs no merges itself.

## Scope boundary

This skill verifies, tags, and cleans up. It never merges a PR, never force-pushes, never rewrites history, and never tags a commit it has not specifically verified through PR evidence.

## Version format

Accept only plain `MAJOR.MINOR.PATCH` (for example `1.4.1`), with no leading `v`, consistent with `start-hotfix` and `create-hotfix-prs`. Resolve `hotfix/<version>` and tag name `v<version>` from it.

## Workflow

1. `git fetch origin --tags`.
2. Find the two hotfix PRs for `hotfix/<version>`:
   - PR from `hotfix/<version>` into `main`.
   - PR from `hotfix/<version>` into `develop`.
   - Use `gh pr list --head hotfix/<version> --state all --json number,baseRefName,state,mergeCommit` (or equivalent) to locate both, regardless of open/closed/merged state.
3. Verify both are merged. If either is not in a merged state, stop and report which PR(s) are not merged; do not proceed to tagging, and do not merge them yourself.
4. Resolve the exact commit that landed on `main`:
   - Read the merge commit SHA directly from the `main`-targeting PR's own merge evidence (for example `gh pr view <number> --json mergeCommit`), not from the current tip of `main`.
   - If the merge commit cannot be resolved unambiguously from PR evidence, stop and report the ambiguity rather than guessing.
5. Verify the package version at that exact commit:
   - Read root `package.json` as it exists at the resolved merge commit (for example `git show <merge-commit>:package.json`).
   - Confirm its `"version"` field equals exactly `<version>`. If it does not, stop and report the mismatch; do not tag.
6. Invoke the `create-annotated-tag` skill to create and push `v<version>` at the resolved merge commit, with annotation `Release v<version>`. Do not duplicate its tag-creation or verification logic here.
7. Only after the tag is created and verified, clean up `hotfix/<version>`:
   - Delete the remote branch: `git push origin --delete hotfix/<version>`.
   - Delete the local branch if present: `git branch -d hotfix/<version>`.
   - If the branch was already removed (for example, GitHub auto-deleted it after merge), treat this as a reportable idempotent state, not an error.
8. Report: both PR references (number, merge commit for the `main` PR), the resolved and verified merge commit, the tag created (or confirmed idempotent), and branch cleanup status.

## Idempotency

Re-running this skill after successful finalisation must recognise the already-created tag (via `create-annotated-tag`'s own idempotency) and the already-removed branch, and report success without erroring.

## Failure handling

- If either PR is not merged, stop before any tagging or cleanup.
- If the `main` merge commit cannot be resolved unambiguously from PR evidence, stop and report why.
- If the package version at the resolved commit does not match, stop and report the mismatch; do not tag.
- If `create-annotated-tag` reports a conflicting existing tag or a verification failure, surface that failure directly; do not attempt to force past it.
- If branch cleanup fails after a successful tag, report the tag success separately from the cleanup failure.
- Never merge a PR, rewrite history, or tag a commit that has not been verified against both PR merge state and package version.
