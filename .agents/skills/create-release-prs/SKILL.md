---
name: create-release-prs
description: Create the two release pull requests (release/<version> into main, and release/<version> into develop) without merging either. Use only on an explicit trigger such as "Create release PRs 1.4.0", after start-release has pushed the release branch.
---

# Create Release PRs

Follow this workflow only when the user issues an explicit trigger of the exact form `Create release PRs <version>` (for example "Create release PRs 1.4.0"), recognised per the shared trigger-recognition standard. Do not infer this from other phrasing, and do not run it as a consequence of `start-release` completing — it is a separate, later, explicit step.

## Scope boundary

This skill creates pull requests only. It never merges, enables auto-merge, tags, commits, pushes new changes, or deletes branches. It stops once both PRs exist (or are identified as already existing) for manual review and manual merge.

## Version format

Accept only plain `MAJOR.MINOR.PATCH` (for example `1.4.0`), with no leading `v`, consistent with `start-release`. Reject pre-release (`1.4.0-rc.1`) or build-metadata (`1.4.0+build.5`) suffixes with a clear error.

## Preconditions

1. The trigger supplies an explicit version matching plain `MAJOR.MINOR.PATCH`.
2. `git fetch origin` succeeds and the remote branch `release/<version>` exists. If it does not, stop and report that `start-release <version>` must run first.
3. Read root `package.json` from `origin/release/<version>` and verify its `"version"` field equals exactly `<version>`. If it does not, stop and report the mismatch; do not create PRs against an unexpected version.

## Workflow

1. Complete all preconditions above.
2. For each of the two target bases, check for an existing open PR from `release/<version>` before creating one:
   - `release/<version>` → `main`
   - `release/<version>` → `develop`
   - Use `gh pr list --head release/<version> --base <base> --state open` (or equivalent). If a matching PR exists, record its URL/number and skip creation for that base.
3. For each base that has no existing PR, create one:
   - Compute the complete commit list and diff for that base: merge base of `release/<version>` and that base, through the tip of `release/<version>`.
   - Title: `chore(release): release v<version>`.
   - Body: summarize the complete set of changes being released relative to that base (not just the version-bump commit), validation performed, and risk/rollback notes appropriate to that base (the `main` PR represents a production release; the `develop` PR reconciles the release branch back into ongoing development).
   - Create with `gh pr create --base <base> --head release/<version> --title "chore(release): release v<version>" --body "<body>"`, falling back to the GitHub REST API via `curl` with token-based auth if `gh` is unavailable or fails.
4. Report completion: for both bases, the PR URL and number (whether newly created or pre-existing), and explicitly note that manual review and merge are required next.
5. Do not merge, enable auto-merge, tag, commit, push, or delete any branch.

## Idempotency

- If both PRs already exist, report both and create neither.
- If only one exists, create only the missing one.
- Re-running this skill after both PRs are created must not create duplicates.

## Failure handling

- If the remote `release/<version>` branch does not exist, stop before attempting any PR creation.
- If the package version on the release branch does not match the trigger, stop before attempting any PR creation.
- If PR creation fails for one base (for example, an authentication failure), report the exact failure for that base; do not silently skip it, and do not let a failure on one base prevent reporting the state of the other.
- If neither `gh` nor the REST API fallback succeeds for a given base, report the exact failure and the manual `gh pr create` command the user can run themselves for that base.
