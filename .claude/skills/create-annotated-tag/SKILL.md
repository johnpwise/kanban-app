---
name: create-annotated-tag
description: Create and push a single annotated Git tag against an explicit, exact target commit, with idempotent handling of an identical existing tag and a hard refusal on any conflicting tag. Used as a low-level primitive by finalise-release and finalise-hotfix; can also be invoked directly with an explicit tag name, target commit, and annotation.
---

# Create Annotated Tag

Follow this workflow whenever an annotated tag needs to be created against a specific, already-known commit. This skill never guesses which commit to tag — the caller must supply an exact target commit SHA or a ref that resolves unambiguously to one.

## Scope boundary

This skill creates and pushes exactly one annotated tag. It never creates branches, commits, or PRs, never moves or force-updates an existing tag, and never tags an ambiguous `HEAD` when an exact commit is required by the calling context.

## Required inputs

- **Tag name** (for example `v1.4.0`), supplied explicitly by the caller.
- **Target commit**: an exact SHA, or a ref that resolves to exactly one commit (for example a specific merge commit already identified by the caller). Never resolve this from a branch tip at execution time when the caller expects an exact, previously-identified commit — that ambiguity belongs to the caller, not this skill.
- **Annotation text** (for example `Release v1.4.0`), supplied explicitly by the caller.
- **Remote** (defaults to `origin` unless the caller specifies otherwise).

## Workflow

1. Fetch tags from the remote: `git fetch origin --tags`.
2. Verify the target commit exists locally (`git cat-file -e <target-commit>^{commit}`). If it does not resolve to exactly one commit, stop and report that instead of guessing.
3. Check for an existing tag with this name, locally and on the remote:
   - Resolve the existing tag's target commit if present, dereferencing annotated tags correctly (`git rev-list -n 1 <tag>` or `git rev-parse <tag>^{commit}` locally; for the remote, use `git ls-remote --tags origin "refs/tags/<tag>*"` — passing the bare tag name as the pattern, e.g. `git ls-remote --tags origin <tag>`, suppresses the peeled `^{}` line entirely on current Git, so the glob form or an unfiltered `git ls-remote --tags origin` is required — and prefer the peeled `^{}` entry when present, since that is the commit the annotated tag object points to; the unpeeled entry is the tag object's own SHA, not the commit).
   - If no tag with this name exists locally or remotely, proceed to create it.
   - If a tag with this name exists and already points at the exact target commit (locally and remotely), treat this as idempotent success: skip re-creating and re-pushing, and go straight to verification/reporting.
   - If a tag with this name exists and points at a **different** commit (locally or remotely), stop and report the conflict (existing target vs requested target). Do not move, replace, or force-update it.
4. If the tag does not yet exist, create it locally: `git tag -a <tag> <target-commit> -m "<annotation>"`.
5. Push only this tag's ref, never all tags: `git push <remote> refs/tags/<tag>`. Never use `--force` or `--tags` (which would push every local tag).
6. Verify the remote tag resolves to the expected commit:
   - `git ls-remote --tags <remote> "refs/tags/<tag>*"` (the glob pattern is required to see the peeled entry; the bare tag name as a pattern suppresses it), using the peeled `^{}` entry (or equivalent dereferencing) to compare against the expected target commit SHA.
   - If the remote tag does not resolve to the expected commit, report this as a verification failure; do not assume success from the push command's exit code alone.
7. Report: tag name, target commit, annotation, remote, the push command used, and the verification evidence (remote-resolved commit matching the target).

## Idempotency

Re-running this skill with the same tag name and the same target commit must succeed without creating a duplicate or erroring, after confirming the existing tag already matches.

## Failure handling

- If the target commit does not exist or is ambiguous, stop before creating anything.
- If a conflicting tag already exists at a different commit, stop and report the conflict; never overwrite it.
- If the push fails, report the exact failure; do not report success based on local tag creation alone.
- If remote verification fails (tag missing, or resolves to an unexpected commit), report this explicitly even if the push command appeared to succeed.
