---
name: commit-and-push
description: Stage scoped repository changes, create a Conventional Commit, and push the current branch with upstream tracking. Use when users ask to commit work, save progress, or commit and push, in any repository (Gitflow or not). Never creates or opens a pull request; PR creation is always a separate, explicit request.
---

# Commit and Push

Follow this workflow whenever a completed workload should be committed and pushed. This skill works in any Git repository, whether or not it follows Gitflow.

## Scope boundary

This skill commits and pushes. It never creates a pull request, never merges, and never force-pushes. A separate, explicit PR request is required after this skill stops (see `create-develop-pr` or the relevant release/hotfix skill).

## Workflow

1. Inspect working tree state.
   - Run `git status --short`.
   - Run `git diff --stat`.
   - If there is no diff and nothing staged, report that there is nothing to commit and stop.
2. Confirm commit scope.
   - Group changed files by logical change.
   - If multiple unrelated changes are mixed together, propose split commits rather than bundling them.
   - Ask for clarification only if scope is genuinely ambiguous.
3. Screen for likely secrets before staging.
   - Treat `.env` files, credential/key files, and diffs containing patterns like API keys, private keys, or tokens as likely secrets.
   - Exclude likely secrets from staging and flag them explicitly; do not commit them without explicit user confirmation.
4. Stage only in-scope, screened files.
   - Prefer `git add <file1> <file2>` over broad adds.
   - Use patch staging (`git add -p`) when one file mixes in-scope and out-of-scope changes.
5. Determine the Conventional Commit type from the actual change, not from the branch name.
   - The branch prefix (`feature/*`, `bugfix/*`, `release/*`, `hotfix/*`) provides context only; it does not dictate the commit type.
   - See `references/commit-message-guidelines.md` for the full type list and selection guidance.
6. Draft the commit message.
   - Subject format: `<type>(<optional-scope>): <concise imperative summary>`.
   - Keep the subject concise (target <= 72 characters).
   - Add a body when it materially helps (why, what changed, how it was validated); omit it for genuinely small, self-explanatory changes.
7. Create the commit.
   - Run `git commit -m "<subject>"` (add `-m "<body>"` when a body is included).
   - If a pre-commit hook fails, surface the hook output and stop; do not bypass hooks.
8. Push the current branch.
   - Determine whether the current branch has an upstream (`git rev-parse --abbrev-ref --symbolic-full-name @{u}`).
   - If no upstream exists, push with `git push -u <remote> <branch>` to establish tracking.
   - If an upstream exists, push with `git push`.
   - Never use `--force` or `--force-with-lease`. If a normal push is rejected (for example, non-fast-forward), stop and report the exact error rather than forcing.
9. Verify the result.
   - Run `git rev-parse HEAD` and confirm it matches the pushed commit.
   - Confirm the remote branch ref via `git ls-remote <remote> <branch>` or equivalent, and report the commit SHA, branch, and remote.
10. Stop.
    - Report the commit SHA, branch, remote, and push evidence.
    - Do not create, draft, or suggest opening a pull request as part of this skill's output. If the user wants a PR, they must ask for it separately.

## Commit quality rules

- Keep one logical change per commit.
- Avoid vague subjects such as `update stuff` or `misc fixes`.
- Use imperative tone (`add`, `fix`, `remove`, not `added`, `fixes`, `removed`).
- Mention breaking changes explicitly in the body.
- If hooks fail, surface hook output and stop before retrying.

## Safety checks

- Never commit secrets, credentials, or environment files unless the user explicitly confirms after being shown the flagged content.
- Avoid committing generated artifacts unless repository policy requires them.
- If unrelated changes are present alongside the intended change, propose split commits instead of bundling them into one.
- Never push to a protected long-lived branch (for example `main` or `develop`) when repository policy prohibits direct pushes; report the restriction instead of pushing.

## Message templates

Use the detailed type reference and templates in `references/commit-message-guidelines.md`.
