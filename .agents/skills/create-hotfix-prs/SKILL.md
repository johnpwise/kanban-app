---
name: create-hotfix-prs
description: Create the two hotfix pull requests (hotfix/<version> into main, and hotfix/<version> into develop) without merging either. Use only on an explicit trigger such as "Create hotfix PRs 1.4.1", after start-hotfix and any fix commits have been pushed.
---

# Create Hotfix PRs

Follow this workflow only when the user issues an explicit trigger of the exact form `Create hotfix PRs <version>` (for example "Create hotfix PRs 1.4.1"), recognised per the shared trigger-recognition standard. This is the hotfix-lifecycle equivalent of `create-release-prs`, targeting `hotfix/<version>` instead of `release/<version>`; the base branches and PR intent are identical.

## Scope boundary

This skill creates pull requests only. It never merges, enables auto-merge, tags, commits, pushes new changes, or deletes branches. It stops once both PRs exist (or are identified as already existing) for manual review and manual merge.

## Version format

Accept only plain `MAJOR.MINOR.PATCH` (for example `1.4.1`), with no leading `v`, consistent with `start-hotfix`. Reject pre-release or build-metadata suffixes with a clear error.

## Preconditions

1. The trigger supplies an explicit version matching plain `MAJOR.MINOR.PATCH`.
2. `git fetch origin` succeeds and the remote branch `hotfix/<version>` exists. If it does not, stop and report that `start-hotfix <version>` must run first.
3. Read root `package.json` from `origin/hotfix/<version>` and verify its `"version"` field equals exactly `<version>`. If it does not, stop and report the mismatch; do not create PRs against an unexpected version.

## Workflow

1. Complete all preconditions above.
2. For each of the two target bases, check for an existing open PR from `hotfix/<version>` before creating one:
   - `hotfix/<version>` → `main`
   - `hotfix/<version>` → `develop`
   - Use `gh pr list --head hotfix/<version> --base <base> --state open` (or equivalent). If a matching PR exists, record its URL/number and skip creation for that base.
3. For each base that has no existing PR, create one:
   - Compute the complete commit list and diff for that base: merge base of `hotfix/<version>` and that base, through the tip of `hotfix/<version>`.
   - Title: `fix(release): hotfix v<version>`.
   - Body: summarize the complete set of fix changes relative to that base, validation performed, and risk/rollback notes appropriate to that base (the `main` PR represents an urgent production correction; the `develop` PR reconciles the fix back into ongoing development).
   - Create with `gh pr create --base <base> --head hotfix/<version> --title "fix(release): hotfix v<version>" --body "<body>"`, falling back to the GitHub REST API via `curl` with token-based auth if `gh` is unavailable or fails.
4. Report completion: for both bases, the PR URL and number (whether newly created or pre-existing), and explicitly note that manual review and merge are required next.
5. Do not merge, enable auto-merge, tag, commit, push, or delete any branch.

## Idempotency

- If both PRs already exist, report both and create neither.
- If only one exists, create only the missing one.
- Re-running this skill after both PRs are created must not create duplicates.

## Failure handling

- If the remote `hotfix/<version>` branch does not exist, stop before attempting any PR creation.
- If the package version on the hotfix branch does not match the trigger, stop before attempting any PR creation.
- If PR creation fails for one base, report the exact failure for that base without letting it prevent reporting the state of the other.
- If neither `gh` nor the REST API fallback succeeds for a given base, report the exact failure and the manual `gh pr create` command the user can run themselves for that base.
