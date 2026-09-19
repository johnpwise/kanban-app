---
name: create-develop-pr
description: Create a live GitHub pull request from the current pushed branch into develop, built from the complete commit/diff history since the merge base, not just the latest commit. Use only when the user makes an explicit, separate request such as "create develop PR" or "open a PR into develop". Never runs automatically after a commit and push, and never merges.
---

# Create Develop PR

Follow this workflow only when the user makes an explicit, separate PR request. This skill never runs as an automatic consequence of `commit-and-push` succeeding — a successful commit-and-push is already a complete outcome on its own.

## Scope boundary

This skill creates a live pull request. It never stages files, creates commits, rewrites history, merges, or enables auto-merge. If there is nothing to commit yet, or the current branch is not pushed, stop and report that instead of proceeding.

## Preconditions

1. Confirm the request is an explicit, separate PR request (for example "create develop PR", "open a PR into develop"), not an inference from prior commit activity.
2. Confirm the repository state is clean enough that the PR would represent intended work (no unrelated uncommitted changes that should have been split out).
3. Confirm the current branch is already pushed to the remote (`git rev-parse --abbrev-ref --symbolic-full-name @{u}` resolves, and the local HEAD SHA matches the remote branch tip). If it is not pushed, stop and report that `commit-and-push` (or an equivalent push) must run first.

## Workflow

1. Verify repository and remotes.
   - Confirm `origin` exists (`git remote -v`).
2. Verify the target branch.
   - Run `git fetch origin develop`.
   - Confirm `origin/develop` resolves. If it does not exist, stop and report the exact git error.
3. Compute the complete branch content, not just the latest commit.
   - Find the merge base: `git merge-base origin/develop HEAD`.
   - List every commit since the merge base: `git log --oneline <merge-base>..HEAD`.
   - Compute the complete diff since the merge base: `git diff <merge-base>..HEAD`.
4. Check for an existing PR before creating one.
   - Query for an open PR with this head branch and base `develop` (for example `gh pr list --head <branch> --base develop --state open`).
   - If one exists, report its URL/number and stop; do not create a duplicate.
5. Build PR content from the complete branch history.
   - Title: a concise summary of the overall change, not the wording of the single latest commit.
   - Body: summarize what changed and why across all commits since the merge base, testing/validation performed, and known risks or follow-ups.
6. Create the PR.
   - Use `gh pr create --base develop --head <branch> --title "<title>" --body "<body>"` when the GitHub CLI is available and authenticated.
   - If `gh` is unavailable or fails, fall back to the GitHub REST API via `curl` with token-based auth targeting the same base/head.
   - If neither path succeeds, stop and report the exact failure; do not silently produce an artifact-only PR description in place of a live PR.
7. Report completion.
   - Return the live PR URL, PR number, base branch (`develop`), head branch, and the commit range/diff summary the PR was built from.
   - Do not merge, enable auto-merge, or take any further action on the PR.

## Idempotency

Re-running this skill for the same head/base with no new commits must report the existing PR rather than creating a second one.

## Failure handling

- If `origin/develop` does not exist, stop and report the exact git error.
- If the current branch is not pushed, or the pushed SHA does not match local HEAD, stop and report that before creating a PR.
- If `gh` is unavailable or unauthenticated, and the REST API fallback also fails, report the exact command/API failure and the manual `gh pr create` command the user can run themselves.
- If there are no commits since the merge base with `develop`, do not open a PR; report that there is nothing to merge.
